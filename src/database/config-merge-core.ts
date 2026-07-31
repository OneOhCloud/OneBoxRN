/**
 * Sing-box 配置合并流水线 —— 纯核心，依赖以注入方式提供。
 *
 * 流水线阶段：解析用户配置 → 模板 → [自定义规则] → DNS/日志改写 → TUN 排除项
 * → 服务器节点注入 → JSON 字符串。语句顺序与日志行必须逐字节保持，因为合并后
 * 的配置 JSON 是一份可观测契约（由 sibling test 文件的 golden 锁定）。
 *
 * 副作用全部收敛到 deps 接缝之后：模板供给、自定义规则读取、direct DNS 探测+
 * 持久化、日志等级读取，以及按平台拆分的 TUN 排除项合并，均由外部注入（生产
 * 环境的唯一装配见 helper.ts）。零原生 import，使 node --experimental-strip-types
 * 能直接运行 sibling test。
 */

import type { ConfigType } from '@/definition';
import { injectCustomRules, type RuleAction, type RuleSet } from './custom-rules.ts';
import type { TunConfigLike } from './tun-exclusions.ts';

// 这些 outbound 组 / 伪类型永不视为代理服务器节点。
const EXCLUDED_OUTBOUND_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns']);

// 覆盖运行时 JSON 图的最小结构类型（RouteRuleLike 先例见 custom-rules.ts）。
// 它们不需要改写任何表达式：代码依赖「section 缺失即抛错」这一行为，非空断言
// 精确保留了该运行时行为。

interface DnsServerLike {
    tag: string;
    type?: string;
    server?: string;
    server_port?: number;
    [k: string]: unknown;
}

interface OutboundLike {
    tag: string;
    type: string;
    outbounds?: string[];
    [k: string]: unknown;
}

interface RouteRuleLike {
    domain?: string[];
    domain_suffix?: string[];
    ip_cidr?: string[];
    [k: string]: unknown;
}

export interface SingBoxConfigLike {
    dns?: { servers: DnsServerLike[]; [k: string]: unknown };
    log?: { level?: string; [k: string]: unknown };
    experimental?: { [k: string]: unknown };
    inbounds?: { type?: string; stack?: unknown; [k: string]: unknown }[];
    outbounds?: OutboundLike[];
    route?: { rules?: RouteRuleLike[]; [k: string]: unknown };
    [k: string]: unknown;
}

/** 与 jsLog 的可变参数签名一致，确保输出的日志行逐字节相同。 */
export interface ConfigLogger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface ConfigMergeDeps {
    /**
     * 模板供给（helper 的 getConfigTemplate）。每次调用必须返回全新的对象图 ——
     * 流水线会就地修改它（供给侧契约见 template-cache.ts）。
     */
    getTemplate(mode: ConfigType): Promise<SingBoxConfigLike>;
    /** 自定义路由规则集（store 的 getAllCustomRuleSets）。仅在 'tun-rules' 模式下调用。 */
    getCustomRuleSets(): Promise<Record<RuleAction, RuleSet>>;
    /**
     * 探测并持久化 direct DNS（helper 的 refreshDirectDns）。注入进来，使
     * directDNS 逐字节一致契约的 KV 写入侧留在非纯外壳中，并与 Settings UI 共享。
     */
    resolveDirectDns(fallback: string): Promise<string>;
    /** sing-box 核心日志等级偏好（ProfileConfig.getLogLevel）。 */
    getLogLevel(): string;
    /** 按平台拆分的 TUN 绕行合并（apply-tun-exclusions.{ios,android}）。 */
    applyTunExclusions(userConfig: TunConfigLike, templateConfig: TunConfigLike): void;
    log: ConfigLogger;
}

export interface ConfigMergeInput {
    mode: ConfigType;
    /** 用户导入的配置文件 JSON 字符串（ProfileConfig.getConfigContent）。 */
    userConfigContent: string;
}

export const FALLBACK_DNS = '119.29.29.29';

/**
 * 测速探测 URL 的单一来源（合并期统一覆写模板里的 urltest 组）。
 * 纯 http：与 Clash 系客户端同口径——不含 TLS 往返，数值可比且明显低于模板
 * 自带的 https google 探测；被墙场景也不会因 https 探测失败而删掉可用节点的
 * 延迟历史。设备实测（TUIC 27 节点）https 口径中位数 ~550ms。
 */
export const URLTEST_PROBE_URL = 'http://www.gstatic.com/generate_204';

/**
 * 从合并后的配置中读回 "direct" DNS 的单一来源 —— `dns.servers[tag='system'].server`
 * 的值必须与 Settings UI 从 KV 读到的值逐字节一致（契约见 helper.ts 中
 * refreshDirectDns 的注释）。
 */
export function extractSystemDns(configJson: string): string | null {
    try {
        const cfg = JSON.parse(configJson) as { dns?: { servers?: { tag: string; server?: string }[] } };
        return cfg?.dns?.servers?.find(s => s.tag === 'system')?.server ?? null;
    } catch {
        return null;
    }
}

async function updateDNSToConfig(deps: ConfigMergeDeps, newConfig: SingBoxConfigLike): Promise<void> {
    for (let i = 0; i < newConfig.dns!.servers.length; i++) {
        const server = newConfig.dns!.servers[i];
        if (server.tag === 'system') {
            const fallback = server.server?.trim() || FALLBACK_DNS;
            const directDNS = await deps.resolveDirectDns(fallback);
            deps.log.info('[Config] direct DNS:', directDNS);
            server.type = 'udp';
            server.server = directDNS;
            server.server_port = 53;
            return;
        }
    }
}

async function rewriteConfig(deps: ConfigMergeDeps, newConfig: SingBoxConfigLike): Promise<void> {
    deps.log.info('[Config] rewriteConfig: inject DNS, strip unused fields');
    try {
        await updateDNSToConfig(deps, newConfig);
    } catch (error) {
        deps.log.error('[Config] failed to update DNS config:', error);
        throw error;
    }
    if (newConfig['experimental']) {
        delete newConfig['experimental']['clash_api'];
    }
    // 用用户偏好覆盖 sing-box 核心日志等级（默认 info）。模板自带 `debug`，
    // 噪声大且耗电；用户可在 dev 页面调回去。
    const level = deps.getLogLevel();
    if (!newConfig.log) newConfig.log = {};
    newConfig.log.level = level;
    deps.log.info(`[Config] core log level → ${level}`);
    for (const outbound of newConfig.outbounds ?? []) {
        if (outbound.type === 'urltest') {
            outbound.url = URLTEST_PROBE_URL;
        }
    }
    deps.log.info(`[Config] urltest probe → ${URLTEST_PROBE_URL}`);
}

function injectServerNodes(
    dbConfigData: SingBoxConfigLike,
    newConfig: SingBoxConfigLike,
    log: ConfigLogger,
): string {
    const outboundsSelectorIndex = 1;
    const outboundsUrltestIndex = 2;

    const outboundGroups = newConfig['outbounds']!;
    const outboundsSelector: string[] = outboundGroups[outboundsSelectorIndex]['outbounds']!;
    const outboundsUrltest: string[] = outboundGroups[outboundsUrltestIndex]['outbounds']!;

    // 收集模板中已存在的 tag 以避免重复
    const existingTags = new Set<string>(
        outboundGroups.map((o) => o.tag).filter(Boolean)
    );

    const serverList = dbConfigData.outbounds!.filter(
        (item) => !EXCLUDED_OUTBOUND_TYPES.has(item.type),
    );

    const deduplicatedServers: OutboundLike[] = [];
    for (const server of serverList) {
        if (existingTags.has(server.tag)) {
            log.warn(`[Config] Skipping server with duplicate tag: "${server.tag}"`);
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

/**
 * 纯核心流水线：解析 → 模板 → [自定义规则] → DNS/日志改写 → TUN 排除项 →
 * 服务器节点注入 → JSON 字符串。
 */
export async function buildSingBoxConfig(
    deps: ConfigMergeDeps,
    input: ConfigMergeInput,
): Promise<string> {
    const configJson = JSON.parse(input.userConfigContent) as SingBoxConfigLike;
    const newConfig = await deps.getTemplate(input.mode);

    deps.log.info(`[Config] Building ${input.mode} config`);

    if (input.mode === 'tun-rules') {
        const sets = await deps.getCustomRuleSets();
        injectCustomRules(newConfig, sets);
        deps.log.info('[Config] TUN Stack:', newConfig.inbounds?.[0]?.stack);
    }

    await rewriteConfig(deps, newConfig);
    // 把配置文件按平台的 TUN 绕行列表带入当前生效的配置
    // （Android：exclude_package，iOS：route_exclude_address）。按平台拆分。
    deps.applyTunExclusions(configJson, newConfig);
    return injectServerNodes(configJson, newConfig, deps.log);
}
