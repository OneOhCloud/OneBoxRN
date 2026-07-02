import { configType } from '@/definition';
import { ExpoOneBox } from '@/modules/expo-onebox';
import { classifyFetchError, errorCodeOf } from '@/utils/config-fetch-policy';
import { jsLog } from '@/utils/log-sink';
import { buildTemplateCacheKey, parseSingBoxVersion, resolveVersionPath } from '@/utils/sing-box-template-path';
import { getSingBoxMajorVersion, getSingBoxVersion } from '@/utils/sing-box-version';
import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { parse as parseJsonc } from 'jsonc-parser';
import { applyPlatformTunExclusions } from './apply-tun-exclusions';
import { hasActionAnchor, injectCustomRules } from './custom-rules';
import { SBConfig } from './kv';
import { deleteStoreValue, getAllCustomRuleSets, getStoreValue, setStoreValue } from './store';
import { BUILT_IN_TEMPLATE_OBJECTS } from './template/generated';
import { templateMemoryCache } from './template-cache';

type Item = { tag: string; type: string };
type Dict = any;
type SBJSONConfig = Map<any, any> & { outbounds: any };

export const GET_PROFILES_LIST_SWR_KEY = 'get-profiles-list';

export interface TerminatedPayload { code: number | null; signal: number | null }
export type StatusChangedPayload = void | TerminatedPayload;

// ─── Config template cache key ───────────────────────────────────────────────

// App version is baked at build time from version.json via app.config.ts, so
// every release rotates the template cache key (see buildTemplateCacheKey).
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

export function getConfigTemplateCacheKey(mode: configType): string {
    return buildTemplateCacheKey(APP_VERSION, getSingBoxMajorVersion(), mode);
}

// ─── DNS rewrite ─────────────────────────────────────────────────────────────

const BEST_DNS_TIMEOUT_MS = 2000;
const FALLBACK_DNS = '119.29.29.29';

async function getBestDnsWithTimeout(fallback: string): Promise<string> {
    try {
        return await Promise.race([
            ExpoOneBox.getBestDns(),
            new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error(`getBestDns 超时（${BEST_DNS_TIMEOUT_MS}ms）`)), BEST_DNS_TIMEOUT_MS)
            ),
        ]);
    } catch (e) {
        jsLog.warn('[Config] getBestDns 失败或超时，使用 fallback DNS:', fallback, e);
        return fallback;
    }
}

/**
 * Single source of truth for the "direct" DNS server.
 *
 * Used by both the merge pipeline (updateDNS2Config) and the Settings
 * InfoCard. Callers MUST route through here instead of calling
 * ExpoOneBox.getBestDns / setStoreValue('directDNS', …) on their own, so
 * the value in `dns.servers[tag='system'].server` of the merged config
 * stays byte-identical to the value read from KV by the Settings UI.
 * UI callers MUST go through VpnContext.refreshDirectDns — never import
 * this function from a component / screen / hook.
 *
 * Accepted trade-off: accept possible double native probe + double KV write
 * when the merge pipeline (updateDNS2Config) and the UI's focus refresh fire
 * concurrently, in exchange for not plumbing the merge pipeline through
 * VpnContext (which would invert a layering: DB → UI context → DB). The race
 * window is bounded (both calls settle within the 2s probe timeout) and both
 * writes converge on the same IP value detected by the same OS query, so
 * last-writer-wins is idempotent in practice.
 */
export function extractSystemDns(configJson: string): string | null {
    try {
        const cfg = JSON.parse(configJson) as { dns?: { servers?: { tag: string; server?: string }[] } };
        return cfg?.dns?.servers?.find(s => s.tag === 'system')?.server ?? null;
    } catch {
        return null;
    }
}

export async function refreshDirectDns(fallback: string = FALLBACK_DNS): Promise<string> {
    const raw = await getBestDnsWithTimeout(fallback);
    const trimmed = raw.trim() || FALLBACK_DNS;
    await setStoreValue('directDNS', trimmed);
    return trimmed;
}

export async function updateDNS2Config(newConfig: Dict): Promise<void> {
    for (let i = 0; i < newConfig.dns.servers.length; i++) {
        const server = newConfig.dns.servers[i];
        if (server.tag === 'system') {
            const fallback = server.server?.trim() || FALLBACK_DNS;
            const directDNS = await refreshDirectDns(fallback);
            jsLog.info('[Config] 直连 DNS:', directDNS);
            server.type = 'udp';
            server.server = directDNS;
            server.server_port = 53;
            return;
        }
    }
}

async function rewriteConfig(newConfig: Dict): Promise<void> {
    jsLog.info('[Config] rewriteConfig: 注入 DNS，清理未用字段');
    try {
        await updateDNS2Config(newConfig);
    } catch (error) {
        jsLog.error('[Config] 更新 DNS 配置失败:', error);
        throw error;
    }
    if (newConfig['experimental']) {
        delete newConfig['experimental']['clash_api'];
    }
    // Override the sing-box core log level with the user's preference
    // (default: info). The template ships with `debug` which is noisy
    // and hurts battery; users can bump it back up in the dev page.
    const level = SBConfig.getLogLevel();
    if (!newConfig.log) newConfig.log = {};
    newConfig.log.level = level;
    jsLog.info(`[Config] core log level → ${level}`);
}

// ─── Local bundled templates ──────────────────────────────────────────────────

/**
 * `majorVersion` is the `MAJOR.MINOR` form returned by
 * `getSingBoxMajorVersion()` (e.g. `"1.13"`). Only the supported minor
 * lines gate the lookup — the actual template body is frozen at build
 * time by `scripts/sync-templates.ts` against `SING_BOX_TAG` in
 * `modules/expo-onebox/helper/Makefile`.
 */
export function getDefaultConfigTemplate(mode: configType, majorVersion: string): string {
    if (majorVersion === '1.12' || majorVersion === '1.13') {
        const tpl = BUILT_IN_TEMPLATE_OBJECTS[mode];
        if (!tpl) throw new Error(`Unsupported config type: ${mode}`);
        return JSON.stringify(tpl);
    }
    throw new Error(`Unsupported version: ${majorVersion}`);
}

// ─── Remote template URLs ─────────────────────────────────────────────────────

const TEMPLATE_MODES: configType[] = ['tun-rules', 'tun-global'];

const REMOTE_TEMPLATE_BASE = 'https://onebox-updater.oneoh.cloud/conf-template/raw/refs/heads/main/conf';

function getRemoteTemplateUrl(mode: configType): string {
    const versionPath = resolveVersionPath(parseSingBoxVersion(getSingBoxVersion()));
    return `${REMOTE_TEMPLATE_BASE}/${versionPath}/zh-cn/${mode}.jsonc`;
}

const REMOTE_FETCH_TIMEOUT_MS = 15000;
const TEMPLATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getTemplateCacheTimestampKey(mode: configType): string {
    return `${getConfigTemplateCacheKey(mode)}-ts`;
}

// `templateMemoryCache` is imported from ./template-cache.
// Stored as serialized JSON so every `get` returns an independent object
// graph — see that module's comment for the mutation-safety rationale.

async function fetchRemoteTemplate(mode: configType): Promise<string | null> {
    let url: string;
    try {
        url = getRemoteTemplateUrl(mode);
    } catch (e) {
        jsLog.warn(`[Template] Could not resolve remote URL for "${mode}":`, e);
        return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    const startMs = Date.now();
    try {
        jsLog.info(`[Template] Fetching remote template for "${mode}" from: ${url}`);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) {
            jsLog.warn(`[Template] Remote fetch failed for "${mode}": HTTP ${resp.status} (${Date.now() - startMs}ms) url=${url}`);
            return null;
        }
        const text = await resp.text();
        jsLog.info(`[Template] Remote template fetched for "${mode}" (${text.length} bytes, ${Date.now() - startMs}ms)`);
        return text;
    } catch (e) {
        clearTimeout(timer);
        const elapsed = Date.now() - startMs;
        // Shared errorCode vocabulary (config-fetch-policy). The full URL is a
        // documented exemption: compile-time app-owned host, not user data.
        const code = errorCodeOf(classifyFetchError(e as Error));
        jsLog.warn(`[Template] Remote fetch failed for "${mode}": errorCode=${code} after ${elapsed}ms (limit=${REMOTE_FETCH_TIMEOUT_MS}ms) url=${url}`, e);
        return null;
    }
}

async function getConfigTemplate(mode: configType): Promise<Dict> {
    // All three paths return a fresh object graph — downstream
    // `updateVPNServerConfigFromDB` mutates it (pushes server nodes into
    // `outbounds` / selector / urltest). A shared reference would accumulate
    // nodes across profile switches.
    //   - templateMemoryCache.get: parses from stored JSON string each call.
    //   - getStoreValue: store.get parses raw KV string fresh each call.
    //   - bundled fallback: JSON.parse on each call.

    // 1. In-memory (populated by prefetchConfigTemplates at startup)
    const inMemory = templateMemoryCache.get(mode);
    if (inMemory) return inMemory;

    // 2. KV cache (survives restarts, written by prefetchConfigTemplates).
    //
    // `getStoreValue` auto-parses the raw KV string (see store.ts), so
    // `cached` is already the deserialised object graph — DO NOT
    // `JSON.parse(cached)` again. The previous iteration did, which
    // produced "[object Object]" and threw `Unexpected character: o`
    // on every cold start with a populated cache.
    const cacheKey = getConfigTemplateCacheKey(mode);
    const cached = await getStoreValue(cacheKey, null);
    if (cached && typeof cached === 'object') {
        return cached as Dict;
    }

    // 3. Bundled fallback
    jsLog.info(`[Template] Using local bundled template for "${mode}"`);
    return JSON.parse(getDefaultConfigTemplate(mode, getSingBoxMajorVersion()));
}

/** Prefetch all config templates at app startup. Skips fetch if cache is fresh (< 1 hour old). */
export async function prefetchConfigTemplates(): Promise<void> {
    await Promise.all(
        TEMPLATE_MODES.map(async (mode) => {
            const tsKey = getTemplateCacheTimestampKey(mode);
            const lastFetch = await getStoreValue(tsKey, null);
            if (lastFetch && Date.now() - Number(lastFetch) < TEMPLATE_CACHE_TTL_MS) {
                jsLog.info(`[Template] Cache fresh for "${mode}", skipping fetch`);
                return;
            }

            const remoteText = await fetchRemoteTemplate(mode);
            if (!remoteText) return;
            try {
                const parsed = parseJsonc(remoteText);
                if (!parsed || typeof parsed !== 'object') {
                    jsLog.warn(`[Template] parseJsonc returned non-object for "${mode}" (len=${remoteText.length}); skipping cache.`);
                    return;
                }
                const cacheKey = getConfigTemplateCacheKey(mode);
                // Pass the object directly — store.set JSON-stringifies it once;
                // store.get JSON-parses once. Writing JSON.stringify(parsed)
                // here would double-encode and break the reader.
                await setStoreValue(cacheKey, parsed);
                await setStoreValue(tsKey, String(Date.now()));
                templateMemoryCache.set(mode, parsed);
                jsLog.info(`[Template] Prefetched and cached template for "${mode}"`);
            } catch (e) {
                jsLog.warn(`[Template] Failed to parse prefetched template for "${mode}":`, e);
            }
        })
    );
}

/**
 * Wipe every cached config template: the persisted KV snapshot and its
 * freshness timestamp for each mode, plus the in-memory copy. The next
 * getConfigTemplate() then falls back to the built-in bundled template, and
 * the next prefetchConfigTemplates() refetches the remote fresh.
 *
 * Escape hatch for a stale remote snapshot that predates a route-rule anchor —
 * the same failure the app-versioned cache key (buildTemplateCacheKey) prevents
 * across upgrades, exposed here for on-device recovery without reinstalling.
 */
export async function clearConfigTemplateCache(): Promise<void> {
    templateMemoryCache.clear();
    for (const mode of TEMPLATE_MODES) {
        await deleteStoreValue(getConfigTemplateCacheKey(mode));
        await deleteStoreValue(getTemplateCacheTimestampKey(mode));
    }
    jsLog.info('[Template] Cache cleared for all modes');
}

export interface TemplateCacheInfo {
    mode: configType;
    /** A remote snapshot is persisted in KV (vs. falling back to built-in). */
    cached: boolean;
    /** Age of the cached snapshot in ms, or null when not cached. */
    ageMs: number | null;
    /** The effective template (cache or built-in) carries the reject anchor. */
    hasRejectAnchor: boolean;
}

/**
 * Read-only probe of the template cache for the dev screen: for each mode,
 * whether a remote snapshot is cached, its age, and whether the *effective*
 * template still carries the reject anchor `injectCustomRules` depends on.
 */
export async function inspectConfigTemplateCache(): Promise<TemplateCacheInfo[]> {
    const out: TemplateCacheInfo[] = [];
    for (const mode of TEMPLATE_MODES) {
        const cached = await getStoreValue(getConfigTemplateCacheKey(mode), null);
        const tsRaw = await getStoreValue(getTemplateCacheTimestampKey(mode), null);
        const isCached = !!(cached && typeof cached === 'object');
        const effective = isCached
            ? cached
            : JSON.parse(getDefaultConfigTemplate(mode, getSingBoxMajorVersion()));
        out.push({
            mode,
            cached: isCached,
            ageMs: tsRaw ? Date.now() - Number(tsRaw) : null,
            hasRejectAnchor: hasActionAnchor(effective, 'reject'),
        });
    }
    return out;
}

// ─── Server node injection ────────────────────────────────────────────────────

export async function updateVPNServerConfigFromDB(
    dbConfigData: SBJSONConfig,
    newConfig: SBJSONConfig
): Promise<string> {
    const outboundsSelectorIndex = 1;
    const outboundsUrltestIndex = 2;

    const outboundGroups = newConfig['outbounds'];
    const outboundsSelector: string[] = outboundGroups[outboundsSelectorIndex]['outbounds'];
    const outboundsUrltest: string[] = outboundGroups[outboundsUrltestIndex]['outbounds'];

    // Collect tags already present in the template to avoid duplicates
    const existingTags = new Set<string>(
        outboundGroups.map((o: Item) => o.tag).filter(Boolean)
    );

    const serverList = dbConfigData.outbounds.filter((item: Item) => {
        let flag =
            item.type !== 'selector' &&
            item.type !== 'urltest' &&
            item.type !== 'direct' &&
            item.type !== 'block';
        flag = flag && item.type !== 'dns';
        return flag;
    });

    const deduplicatedServers: Item[] = [];
    for (const server of serverList) {
        if (existingTags.has(server.tag)) {
            jsLog.warn(`[Config] Skipping server with duplicate tag: "${server.tag}"`);
            continue;
        }
        existingTags.add(server.tag);
        server['domain_resolver'] = 'system';
        deduplicatedServers.push(server);
        outboundsSelector.push(server.tag);
        outboundsUrltest.push(server.tag);
    }

    outboundGroups.push(...deduplicatedServers);

    return JSON.stringify(newConfig);
}

// ─── TUN modes ───────────────────────────────────────────────────────────────

export async function getTunConfig(config: string): Promise<string> {
    const configJson = JSON.parse(config);
    const newConfig = await getConfigTemplate('tun-rules');

    jsLog.info('[Config] Building tun-rules config');

    const sets = await getAllCustomRuleSets();
    injectCustomRules(newConfig, sets);

    jsLog.info('[Config] TUN Stack:', newConfig.inbounds?.[0]?.stack);
    await rewriteConfig(newConfig);
    // Carry the profile's per-platform TUN bypass list into the active config
    // (Android: exclude_package, iOS: route_exclude_address). Platform-split.
    applyPlatformTunExclusions(configJson, newConfig);
    return updateVPNServerConfigFromDB(configJson, newConfig);
}

/** 全局代理模式：所有流量走 ExitGateway，使用 tun-global 模板 */
export default async function getGlobalTunConfig(config: string): Promise<string> {
    const configJson = JSON.parse(config);
    const newConfig = await getConfigTemplate('tun-global');
    jsLog.info('[Config] Building tun-global config');
    await rewriteConfig(newConfig);
    applyPlatformTunExclusions(configJson, newConfig);
    return updateVPNServerConfigFromDB(configJson, newConfig);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function getProcessedConfig(): Promise<string> {
    const mode = SBConfig.getMode();
    const configContent = SBConfig.getConfigContent();
    if (!configContent) throw new Error('No config content found');

    switch (mode) {
        case 'tun-rules': return getTunConfig(configContent);
        case 'tun-global': return getGlobalTunConfig(configContent);
        default: throw new Error(`Unsupported config type: ${mode}`);
    }
}
