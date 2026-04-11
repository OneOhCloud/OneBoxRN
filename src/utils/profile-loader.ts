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
import Constants from 'expo-constants';

// ── Compile-time constant ─────────────────────────────────────────────────────
// Populated from accelerateUrl env var via app.config.ts at build time.
const ACCELERATE_URL: string | null =
    (Constants.expoConfig?.extra?.accelerateUrl as string | null) ?? null;

// ── Domain verification constants ─────────────────────────────────────────────
const KNOWN_DOMAIN_SHA256 = '183a5526e76751b07cd57236bc8f253d5424e02a3fc7da7c30f80919e975125a';
const VERIFIED_LIST_URL = 'https://www.sing-box.net/verified_subscriptions_sha256.txt';

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

async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

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
 * Verify a config hostname against:
 *   A) a hardcoded known-good SHA256, or
 *   B) the official verified list from sing-box.net.
 * Either condition passing is sufficient.
 */
async function verifyDomain(hostname: string, domainSha256: string): Promise<boolean> {
    // Method A: local comparison
    if (domainSha256 === KNOWN_DOMAIN_SHA256) {
        return true;
    }

    // Method B: fetch the official whitelist
    try {
        const resp = await fetchWithTimeout(VERIFIED_LIST_URL, {}, 10_000);
        if (resp.ok) {
            const text = await resp.text();
            const hashes = text.split('\n').map(l => l.trim()).filter(Boolean);
            if (hashes.includes(domainSha256)) {
                return true;
            }
        }
    } catch {
        // If the whitelist fetch fails we fall through and reject
    }

    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigFetchResult {
    content: string;
    headers: Headers;
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
): Promise<ConfigFetchResult> {
    // ── Step 1: domain verification ──────────────────────────────────────────
    const hostname = new URL(originalUrl).hostname;
    const domainSha256 = await sha256Hex(hostname);
    const verified = await verifyDomain(hostname, domainSha256);

    if (!verified) {
        console.warn(
            `[CONFIG_LOAD] 方式=DOMAIN_UNVERIFIED, 域名SHA256=${domainSha256}, 加速备用已禁用`,
        );
    }

    const requestHeaders = { 'User-Agent': userAgent };

    // ── Step 2: primary URL ───────────────────────────────────────────────────
    let primaryErrorLabel: string | null = null;

    try {
        const resp = await fetchWithTimeout(originalUrl, { method: 'GET', headers: requestHeaders }, 10_000);

        if (!resp.ok) {
            // HTTP error — do not fall back; surface immediately
            throw new Error(`获取配置失败，HTTP状态码: ${resp.status}`);
        }

        const content = await resp.text();
        console.log(`[CONFIG_LOAD] 方式=PRIMARY, URL=${originalUrl}`);
        return { content, headers: resp.headers };
    } catch (err) {
        if (!isNetworkFault(err)) {
            // HTTP errors, malformed responses, etc. — propagate directly
            throw err;
        }
        primaryErrorLabel = (err as Error).name; // 'AbortError' | 'TypeError'
    }

    // ── Step 3: accelerator fallback (verified domains only) ─────────────────
    if (!verified) {
        console.warn(
            `[CONFIG_LOAD] 方式=ACCELERATOR_SKIPPED, 原因=域名未验证, 主地址原因=${primaryErrorLabel}`,
        );
        throw new Error(`配置加载失败: 主地址不可达(${primaryErrorLabel}), 域名未验证禁止使用加速`);
    }

    if (acceleratorAvailable === null) {
        await checkAcceleratorAvailability();
    }

    if (!acceleratorAvailable) {
        console.warn(
            `[CONFIG_LOAD] 方式=ACCELERATOR_UNAVAILABLE, 原因=不可达:443, 回退中止`,
        );
        throw new Error(`配置加载失败: 主地址不可达(${primaryErrorLabel}), 加速地址不可用`);
    }

    const acceleratedUrl = buildAcceleratedUrl(originalUrl, domainSha256);

    try {
        const resp = await fetchWithTimeout(
            acceleratedUrl,
            { method: 'GET', headers: requestHeaders },
            10_000,
        );

        if (!resp.ok) {
            const acceleratorErrorLabel = `HTTP_${resp.status}`;
            console.error(
                `[CONFIG_LOAD] 方式=BOTH_FAILED, 主地址原因=${primaryErrorLabel}, 加速地址原因=${acceleratorErrorLabel}`,
            );
            throw new Error(
                `配置加载失败: 主地址(${primaryErrorLabel}) 加速地址(${acceleratorErrorLabel})`,
            );
        }

        const content = await resp.text();
        console.log(
            `[CONFIG_LOAD] 方式=FALLBACK_ACCELERATOR, 原因=${primaryErrorLabel}, 加速URL=${acceleratedUrl}`,
        );
        return { content, headers: resp.headers };
    } catch (err) {
        if ((err as Error).message?.startsWith('配置加载失败')) {
            throw err; // already labelled above
        }
        const acceleratorErrorLabel = isNetworkFault(err) ? (err as Error).name : 'UNKNOWN';
        console.error(
            `[CONFIG_LOAD] 方式=BOTH_FAILED, 主地址原因=${primaryErrorLabel}, 加速地址原因=${acceleratorErrorLabel}`,
        );
        throw new Error(
            `配置加载失败: 主地址(${primaryErrorLabel}) 加速地址(${acceleratorErrorLabel})`,
        );
    }
}
