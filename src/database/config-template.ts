/**
 * Sing-box 配置模板子系统 —— 拉取、缓存并检视合并流水线所依赖的按模式区分的
 * 配置模板。
 *
 * 职责：远程拉取（app 自有的模板 host）、三级供给链（内存缓存 → KV 快照 →
 * 内置 fallback）、启动预取、缓存清除，以及 dev 页面探针。`mode` 是本模块的
 * 领域参数 —— 每个入口都随它而变。
 */

import { ConfigType } from '@/definition';
import { classifyFetchError, errorCodeOf } from '@/utils/config-fetch-policy';
import { jsLog } from '@/utils/log-sink';
import { buildTemplateCacheKey, parseSingBoxVersion, resolveVersionPath } from '@/utils/sing-box-template-path';
import { getSingBoxMajorVersion, getSingBoxVersion } from '@/utils/sing-box-version';
import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { parse as parseJsonc } from 'jsonc-parser';
import type { SingBoxConfigLike } from './config-merge-core';
import { hasActionAnchor } from './custom-rules';
import { deleteStoreValue, getStoreValue, setStoreValue } from './store';
import { BUILT_IN_TEMPLATE_OBJECTS } from './template/generated';
import { templateMemoryCache } from './template-cache';

// ─── 配置模板缓存 key ───────────────────────────────────────────────

// app 版本在构建期由 app.config.ts 从 version.json 烘焙进来，因此每次发布都会
// 轮换模板缓存 key（见 buildTemplateCacheKey）。
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

export function getConfigTemplateCacheKey(mode: ConfigType): string {
    return buildTemplateCacheKey(APP_VERSION, getSingBoxMajorVersion(), mode);
}

// ─── 本地内置模板 ──────────────────────────────────────────────────

/**
 * `majorVersion` 是 `getSingBoxMajorVersion()` 返回的 `MAJOR.MINOR` 形式
 * （如 `"1.13"`）。查找只按受支持的 minor 线路把关 —— 模板正文本身在构建期由
 * `scripts/sync-templates.ts` 依据 `modules/expo-onebox/helper/Makefile` 里的
 * `SING_BOX_TAG` 冻结。
 */
export function getDefaultConfigTemplate(mode: ConfigType, majorVersion: string): string {
    if (majorVersion === '1.12' || majorVersion === '1.13' || majorVersion === '1.14') {
        const tpl = BUILT_IN_TEMPLATE_OBJECTS[mode];
        if (!tpl) throw new Error(`Unsupported config type: ${mode}`);
        return JSON.stringify(tpl);
    }
    throw new Error(`Unsupported version: ${majorVersion}`);
}

// ─── 远程模板 URL ─────────────────────────────────────────────────────

const TEMPLATE_MODES: ConfigType[] = ['tun-rules', 'tun-global'];

const REMOTE_TEMPLATE_BASE = 'https://onebox-updater.oneoh.cloud/conf-template/raw/refs/heads/dev/conf';

function getRemoteTemplateUrl(mode: ConfigType): string {
    const versionPath = resolveVersionPath(parseSingBoxVersion(getSingBoxVersion()));
    return `${REMOTE_TEMPLATE_BASE}/${versionPath}/zh-cn/${mode}.jsonc`;
}

const REMOTE_FETCH_TIMEOUT_MS = 15000;
const TEMPLATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getTemplateCacheTimestampKey(mode: ConfigType): string {
    return `${getConfigTemplateCacheKey(mode)}-ts`;
}

// `templateMemoryCache` 从 ./template-cache 导入。
// 以序列化 JSON 存储，使每次 `get` 都返回独立的对象图 —— 变更安全的理由见该
// 模块的注释。

async function fetchRemoteTemplate(mode: ConfigType): Promise<string | null> {
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
        // 共享的 errorCode 词表（config-fetch-policy）。完整 URL 属于已记录的
        // 豁免：编译期确定的 app 自有 host，非用户数据。
        const code = errorCodeOf(classifyFetchError(e as Error));
        jsLog.warn(`[Template] Remote fetch failed for "${mode}": errorCode=${code} after ${elapsed}ms (limit=${REMOTE_FETCH_TIMEOUT_MS}ms) url=${url}`, e);
        return null;
    }
}

export async function getConfigTemplate(mode: ConfigType): Promise<SingBoxConfigLike> {
    // 三条路径都返回全新的对象图 —— 合并流水线（config-merge-core 的
    // buildSingBoxConfig）会就地修改它（把服务器节点 push 进 `outbounds` /
    // selector / urltest）。共享引用会在切换配置文件时累积。
    //   - templateMemoryCache.get：每次调用从存储的 JSON 字符串解析。
    //   - getStoreValue：store.get 每次调用重新解析原始 KV 字符串。
    //   - 内置 fallback：每次调用做 JSON.parse。

    // 1. 内存缓存（启动时由 prefetchConfigTemplates 填充）
    const inMemory = templateMemoryCache.get(mode);
    if (inMemory) return inMemory;

    // 2. KV 缓存（可跨重启，由 prefetchConfigTemplates 写入）。
    //
    // `getStoreValue` 会自动解析原始 KV 字符串（见 store.ts），因此 `cached`
    // 已是反序列化后的对象图 —— 切勿再 `JSON.parse(cached)`。二次解析会得到
    // "[object Object]" 并抛出 `Unexpected character: o`。
    const cacheKey = getConfigTemplateCacheKey(mode);
    const cached = await getStoreValue(cacheKey, null);
    if (cached && typeof cached === 'object') {
        return cached as SingBoxConfigLike;
    }

    // 3. 内置 fallback
    jsLog.info(`[Template] Using local bundled template for "${mode}"`);
    return JSON.parse(getDefaultConfigTemplate(mode, getSingBoxMajorVersion()));
}

/** 在 app 启动时预取所有配置模板。缓存新鲜（< 1 小时）时跳过拉取。 */
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
                // 直接传对象 —— store.set 会做一次 JSON 序列化，store.get 做
                // 一次 JSON 解析。这里写 JSON.stringify(parsed) 会双重编码，
                // 破坏读取端。
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
 * 清除所有缓存的配置模板：每个模式持久化的 KV 快照及其新鲜度时间戳，加上内存
 * 副本。此后下一次 getConfigTemplate() 会回落到内置模板，下一次
 * prefetchConfigTemplates() 会重新拉取远程。
 *
 * 用于应对早于某个 route-rule 锚点的陈旧远程快照 —— 与按 app 版本轮换的缓存
 * key（buildTemplateCacheKey）在升级时防止的是同一类故障，这里暴露出来是为了
 * 无需重装即可在设备上恢复。
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
    mode: ConfigType;
    /** KV 中持久化了远程快照（而非回落到内置模板）。 */
    cached: boolean;
    /** 缓存快照的年龄（毫秒），未缓存时为 null。 */
    ageMs: number | null;
    /** 当前生效的模板（缓存或内置）携带 reject 锚点。 */
    hasRejectAnchor: boolean;
}

/**
 * 供 dev 页面用的只读模板缓存探针：对每个模式，报告是否缓存了远程快照、其年龄，
 * 以及*当前生效的*模板是否仍携带 injectCustomRules 所依赖的 reject 锚点。
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
