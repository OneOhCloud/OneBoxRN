import { configType, SING_BOX_MAJOR_VERSION, SING_BOX_VERSION } from '@/definition';
import { ExpoOneBox } from '@/modules/expo-onebox';
import { SBConfig } from './kv';
import { getCustomRuleSet, getStoreValue, setStoreValue } from './store';
import TunGlobalConfig from './template/zh/global';
import TunRulesConfig from './template/zh/rules';

type Item = { tag: string; type: string };
type Dict = any;
type SBJSONConfig = Map<any, any> & { outbounds: any };

export const GET_PROFILES_LIST_SWR_KEY = 'get-profiles-list';

export interface TerminatedPayload { code: number | null; signal: number | null }
export type StatusChangedPayload = void | TerminatedPayload;

// ─── Config template cache key ───────────────────────────────────────────────

export async function getConfigTemplateCacheKey(mode: configType): Promise<string> {
    return `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-config-cache`;
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
        console.warn('[Config] getBestDns 失败或超时，使用 fallback DNS:', fallback, e);
        return fallback;
    }
}

export async function updateDNS2Config(newConfig: Dict): Promise<void> {
    for (let i = 0; i < newConfig.dns.servers.length; i++) {
        const server = newConfig.dns.servers[i];
        if (server.tag === 'system') {
            const fallback = server.server?.trim() || FALLBACK_DNS;
            const directDNS = await getBestDnsWithTimeout(fallback);
            await setStoreValue('directDNS', directDNS);
            console.log('[Config] 直连 DNS:', directDNS);
            server.type = 'udp';
            server.server = directDNS.trim();
            server.server_port = 53;
            return;
        }
    }
}

async function rewriteConfig(newConfig: Dict): Promise<void> {
    console.log('[Config] rewriteConfig: 注入 DNS，清理未用字段');
    try {
        await updateDNS2Config(newConfig);
    } catch (error) {
        console.error('[Config] 更新 DNS 配置失败:', error);
        throw error;
    }
    if (newConfig['experimental']) {
        delete newConfig['experimental']['clash_api'];
    }
}

// ─── Local bundled templates ──────────────────────────────────────────────────

export function getDefaultConfigTemplate(mode: configType, version: string): string {
    if (version.startsWith('v1.12') || version.startsWith('v1.13')) {
        switch (mode) {
            case 'tun-rules': return JSON.stringify(TunRulesConfig);
            case 'tun-global': return JSON.stringify(TunGlobalConfig);
            default: throw new Error(`Unsupported config type: ${mode}`);
        }
    }
    throw new Error(`Unsupported version: ${version}`);
}

// ─── Remote template URLs ─────────────────────────────────────────────────────

//             return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/tun-rules.jsonc`;

const REMOTE_TEMPLATE_URLS: Record<configType, string> = {

    'tun-rules': 'https://onebox-updater.oneoh.cloud/conf-template/raw/refs/heads/main/conf/1.13/zh-cn/tun-rules.jsonc',
    'tun-global': 'https://onebox-updater.oneoh.cloud/conf-template/raw/refs/heads/main/conf/1.13/zh-cn/tun-global.jsonc',
};

const REMOTE_FETCH_TIMEOUT_MS = 5000;

// 剥离 JSONC 注释（单行 // 和多行块注释），使 JSON.parse 可正常解析。
// 注意：不处理字符串内的注释字符，对标准 JSONC 配置已足够。
function stripJsonComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')   // 多行注释
        .replace(/\/\/[^\n\r]*/g, '');       // 单行注释
}

/**
 * 从 GitHub 拉取指定 mode 的配置模板。
 * 超时 5 s 或请求失败时返回 null。
 */
async function fetchRemoteTemplate(mode: configType): Promise<string | null> {
    const url = REMOTE_TEMPLATE_URLS[mode];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    try {
        console.log(`[Template] Fetching remote template for "${mode}" from: ${url}`);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) {
            console.warn(`[Template] Remote fetch failed for "${mode}": HTTP ${resp.status}`);
            return null;
        }
        const text = await resp.text();
        console.log(`[Template] Remote template fetched for "${mode}" (${text.length} bytes)`);
        return text;
    } catch (e) {
        clearTimeout(timer);
        if ((e as Error).name === 'AbortError') {
            console.warn(`[Template] Remote fetch timed out for "${mode}"`);
        } else {
            console.warn(`[Template] Remote fetch error for "${mode}":`, e);
        }
        return null;
    }
}

/**
 * 获取指定 mode 的配置模板，优先级：
 *  1. 远程 GitHub（成功则更新缓存）
 *  2. 本地缓存（上次成功拉取的结果）
 *  3. 本地内置模板（最终兜底）
 */
async function getConfigTemplate(mode: configType): Promise<Dict> {
    const cacheKey = await getConfigTemplateCacheKey(mode);

    // 1. 尝试从远程拉取
    const remoteText = await fetchRemoteTemplate(mode);
    if (remoteText) {
        try {
            const parsed = JSON.parse(stripJsonComments(remoteText));
            await setStoreValue(cacheKey, JSON.stringify(parsed));
            console.log(`[Template] Using remote template for "${mode}"`);
            return parsed;
        } catch (e) {
            console.warn(`[Template] Failed to parse remote template for "${mode}":`, e);
        }
    }

    // 2. 尝试本地缓存（上次成功的远程结果）
    const cached = await getStoreValue(cacheKey, null);
    if (cached) {
        try {
            console.log(`[Template] Using cached template for "${mode}"`);
            return JSON.parse(cached);
        } catch (e) {
            console.warn(`[Template] Failed to parse cached template for "${mode}":`, e);
        }
    }

    // 3. 兜底：使用本地内置模板
    console.log(`[Template] Using local bundled template for "${mode}"`);
    return JSON.parse(getDefaultConfigTemplate(mode, SING_BOX_VERSION));
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
            console.warn(`[Config] Skipping server with duplicate tag: "${server.tag}"`);
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

    console.log('[Config] Building tun-rules config');

    const directRuleSet = await getCustomRuleSet('direct');
    const proxyRuleSet = await getCustomRuleSet('proxy');

    for (const rule of newConfig.route.rules) {
        if (!rule.domain || !Array.isArray(rule.domain)) continue;
        if (rule.domain.includes('direct-tag.oneoh.cloud')) {
            rule.domain.push(...directRuleSet.domain);
            rule.domain_suffix.push(...directRuleSet.domain_suffix);
            rule.ip_cidr.push(...directRuleSet.ip_cidr);
        }
        if (rule.domain.includes('proxy-tag.oneoh.cloud')) {
            rule.domain.push(...proxyRuleSet.domain);
            rule.domain_suffix.push(...proxyRuleSet.domain_suffix);
            rule.ip_cidr.push(...proxyRuleSet.ip_cidr);
        }
    }

    console.log('[Config] TUN Stack:', newConfig.inbounds?.[0]?.stack);
    await rewriteConfig(newConfig);
    return updateVPNServerConfigFromDB(configJson, newConfig);
}

/** 全局代理模式：所有流量走 ExitGateway，使用 tun-global 模板 */
export default async function getGlobalTunConfig(config: string): Promise<string> {
    const configJson = JSON.parse(config);
    const newConfig = await getConfigTemplate('tun-global');
    console.log('[Config] Building tun-global config');
    await rewriteConfig(newConfig);
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
