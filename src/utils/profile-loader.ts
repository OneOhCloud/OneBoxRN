/**
 * Profile remote-config loader with intelligent fallback.
 *
 * Priority:
 *   1. Primary URL (original config address)
 *   2. Accelerated URL (only on TCP-level failures, if accelerator is available)
 *
 * Every load path emits a structured log line starting with [CONFIG_LOAD].
 */

import { fetchWithTimeout } from '@/utils';
import {
    getKnownDomainSha256List,
    getVerifiedDomainsList,
    updateVerificationData,
} from '@/utils/domain-verification';
import { hostnameMatchesAnyAllowlist, sha256Hex } from '@/utils/domain-suffix';
import { jsLog } from '@/utils/log-sink';
import Constants from 'expo-constants';

// ── Compile-time constant ─────────────────────────────────────────────────────
// Populated from accelerateUrl env var via app.config.ts at build time.
const ACCELERATE_URL: string | null =
    (Constants.expoConfig?.extra?.accelerateUrl as string | null) ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// Accelerator reachability cache (null = unchecked, true/false = result)
// ─────────────────────────────────────────────────────────────────────────────

let acceleratorAvailable: boolean | null = null;

async function checkAcceleratorAvailability(): Promise<void> {
    if (!ACCELERATE_URL) {
        acceleratorAvailable = false;
        return;
    }
    try {
        await fetchWithTimeout(ACCELERATE_URL, { method: 'HEAD' }, 5_000);
        acceleratorAvailable = true;
    } catch {
        acceleratorAvailable = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────


/**
 * Classify whether an error represents a TCP-level network fault that
 * warrants falling back to the accelerator.
 * Covers: AbortError (timeout), TypeError (network failure / DNS / reset).
 */
function isNetworkFault(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.name === 'AbortError' || err.name === 'TypeError';
}

/**
 * Build the accelerated variant of an original config URL.
 *
 *   <ACCELERATE_URL>/<domainSha256><originalPath+Query>
 *
 * Example:
 *   original  → https://xxxxxxx.com/sub/abc?protocol=tuic
 *   accelerated → https://edge-sub.../183a5526.../sub/abc?protocol=tuic
 */
function buildAcceleratedUrl(originalUrl: string, domainSha256: string): string {
    const { pathname, search } = new URL(originalUrl);
    return `${ACCELERATE_URL}/${domainSha256}${pathname}${search}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thin wrapper around the pure `hostnameMatchesAnyAllowlist` primitive:
 * reads both KV-backed allowlists from `domain-verification.ts` and
 * delegates the suffix-hash check. On a miss, fires a non-blocking
 * whitelist refresh (TTL-gated inside `updateVerificationData`) so the
 * next verify benefits from newer data.
 *
 * Mirrors OneBox/Tauri `verify_hostname` semantics: zero network in the
 * hot path, both the compile-time list and the remote-cached list
 * considered in one suffix traversal.
 */
export async function verifyHostname(hostname: string): Promise<boolean> {
    const known    = new Set<string>(getKnownDomainSha256List());
    const verified = new Set<string>(getVerifiedDomainsList());
    const ok       = await hostnameMatchesAnyAllowlist(hostname, known, verified);
    if (!ok) void updateVerificationData(false);
    return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigFetchResult {
    content: string;
    headers: Headers;
}

export interface FetchConfigWithFallbackOptions {
    signal?: AbortSignal;
}

/**
 * Fetch a remote config with automatic accelerator fallback.
 *
 * Flow:
 *   1. SHA256-verify the config domain (local hash + remote whitelist).
 *   2. Try the primary (original) URL with a 10 s timeout.
 *   3. On TCP-level failure only (timeout / reset / DNS error):
 *        a. Check accelerator reachability (cached after first call).
 *        b. Rewrite URL and retry via accelerator.
 *   4. Emit a [CONFIG_LOAD] log line for every outcome.
 *
 * Throws on:
 *   - domain verification failure
 *   - HTTP non-2xx from primary (no fallback for HTTP errors)
 *   - all network paths exhausted
 */
export async function fetchConfigWithFallback(
    originalUrl: string,
    userAgent: string,
    options?: FetchConfigWithFallbackOptions,
): Promise<ConfigFetchResult> {
    // ── Step 1: domain verification ──────────────────────────────────────────
    const hostname = new URL(originalUrl).hostname;
    const domainSha256 = await sha256Hex(hostname);
    const verified = await verifyHostname(hostname);

    if (!verified) {
        jsLog.warn(
            `[CONFIG_LOAD] 方式=DOMAIN_UNVERIFIED, 域名SHA256=${domainSha256}, 加速备用已禁用`,
        );
    }

    const requestHeaders = { 'User-Agent': userAgent };

    // ── Step 2: primary URL ───────────────────────────────────────────────────
    let primaryErrorLabel: string | null = null;

    try {
        const resp = await fetchWithTimeout(
            originalUrl,
            { method: 'GET', headers: requestHeaders, signal: options?.signal },
            10_000,
        );

        if (!resp.ok) {
            // HTTP error — do not fall back; surface immediately
            throw new Error(`获取配置失败，HTTP状态码: ${resp.status}`);
        }

        const content = await resp.text();
        jsLog.info(`[CONFIG_LOAD] 方式=PRIMARY, URL=${originalUrl}`);
        return { content, headers: resp.headers };
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw err;
        }
        if (!isNetworkFault(err)) {
            // HTTP errors, malformed responses, etc. — propagate directly
            throw err;
        }
        primaryErrorLabel = (err as Error).name; // 'AbortError' | 'TypeError'
    }

    // ── Step 3: accelerator fallback (verified domains only) ─────────────────
    if (!verified) {
        jsLog.warn(
            `[CONFIG_LOAD] 方式=ACCELERATOR_SKIPPED, 原因=域名未验证, 主地址原因=${primaryErrorLabel}`,
        );
        throw new Error(`配置加载失败: 主地址不可达(${primaryErrorLabel}), 域名未验证禁止使用加速`);
    }

    if (acceleratorAvailable === null) {
        await checkAcceleratorAvailability();
    }

    if (!acceleratorAvailable) {
        jsLog.warn(
            `[CONFIG_LOAD] 方式=ACCELERATOR_UNAVAILABLE, 原因=不可达:443, 回退中止`,
        );
        throw new Error(`配置加载失败: 主地址不可达(${primaryErrorLabel}), 加速地址不可用`);
    }

    const acceleratedUrl = buildAcceleratedUrl(originalUrl, domainSha256);

    try {
        const resp = await fetchWithTimeout(
            acceleratedUrl,
            { method: 'GET', headers: requestHeaders, signal: options?.signal },
            10_000,
        );

        if (!resp.ok) {
            const acceleratorErrorLabel = `HTTP_${resp.status}`;
            jsLog.error(
                `[CONFIG_LOAD] 方式=BOTH_FAILED, 主地址原因=${primaryErrorLabel}, 加速地址原因=${acceleratorErrorLabel}`,
            );
            throw new Error(
                `配置加载失败: 主地址(${primaryErrorLabel}) 加速地址(${acceleratorErrorLabel})`,
            );
        }

        const content = await resp.text();
        jsLog.info(
            `[CONFIG_LOAD] 方式=FALLBACK_ACCELERATOR, 原因=${primaryErrorLabel}, 加速URL=${acceleratedUrl}`,
        );
        return { content, headers: resp.headers };
    } catch (err) {
        if ((err as Error).message?.startsWith('配置加载失败')) {
            throw err; // already labelled above
        }
        const acceleratorErrorLabel = isNetworkFault(err) ? (err as Error).name : 'UNKNOWN';
        jsLog.error(
            `[CONFIG_LOAD] 方式=BOTH_FAILED, 主地址原因=${primaryErrorLabel}, 加速地址原因=${acceleratorErrorLabel}`,
        );
        throw new Error(
            `配置加载失败: 主地址(${primaryErrorLabel}) 加速地址(${acceleratorErrorLabel})`,
        );
    }
}
