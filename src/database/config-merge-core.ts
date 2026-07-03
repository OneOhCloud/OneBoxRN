/**
 * Sing-box config merge pipeline — pure core with injected dependencies.
 *
 * Verbatim assembly of the former helper.ts chain (getTunConfig /
 * getGlobalTunConfig / rewriteConfig / updateDNSToConfig /
 * updateVPNServerConfigFromDB): parse user profile → template → [custom
 * rules] → DNS/log rewrite → TUN exclusions → server-node injection →
 * JSON string. Statement order and log lines are preserved byte-for-byte —
 * the merged config JSON is an observable contract (golden-tested by the
 * sibling test file).
 *
 * Effects stay behind deps seams: template supply, custom-rule reads, the
 * direct-DNS probe+persist, log-level read, and the platform-split TUN
 * exclusion merge are all injected (see helper.ts for the one production
 * wiring). Zero native imports so node --experimental-strip-types can run
 * the sibling test directly.
 */

import type { ConfigType } from '@/definition';
import { injectCustomRules, type RuleAction, type RuleSet } from './custom-rules.ts';
import type { TunConfigLike } from './tun-exclusions.ts';

// Outbound group / pseudo types that are never treated as proxy server nodes.
const EXCLUDED_OUTBOUND_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns']);

// Minimal structural types over the runtime JSON graphs (RouteRuleLike
// precedent in custom-rules.ts). They never force rewriting an expression:
// where the former `Dict = any` code relied on a missing section throwing,
// a non-null assertion keeps that exact runtime behavior.

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

/** Matches jsLog's varargs surface so emitted lines stay byte-identical. */
export interface ConfigLogger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface ConfigMergeDeps {
    /**
     * Template supply (helper getConfigTemplate). MUST return a fresh object
     * graph per call — the pipeline mutates it in place (see
     * template-cache.ts for the supply-side contract).
     */
    getTemplate(mode: ConfigType): Promise<SingBoxConfigLike>;
    /** Custom routing rule sets (store getAllCustomRuleSets). Only invoked for 'tun-rules'. */
    getCustomRuleSets(): Promise<Record<RuleAction, RuleSet>>;
    /**
     * Probe + persist the direct DNS (helper refreshDirectDns). Injected so
     * the KV-write side of the directDNS byte-identity contract stays in the
     * impure shell, shared with the Settings UI.
     */
    resolveDirectDns(fallback: string): Promise<string>;
    /** sing-box core log level preference (ProfileConfig.getLogLevel). */
    getLogLevel(): string;
    /** Platform-split TUN bypass merge (apply-tun-exclusions.{ios,android}). */
    applyTunExclusions(userConfig: TunConfigLike, templateConfig: TunConfigLike): void;
    log: ConfigLogger;
}

export interface ConfigMergeInput {
    mode: ConfigType;
    /** The user's imported profile JSON string (ProfileConfig.getConfigContent). */
    userConfigContent: string;
}

export const FALLBACK_DNS = '119.29.29.29';

/**
 * Single source of truth for reading the "direct" DNS back out of a merged
 * config — the value in `dns.servers[tag='system'].server` must stay
 * byte-identical to the KV value the Settings UI reads (see the
 * refreshDirectDns contract comment in helper.ts).
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
            deps.log.info('[Config] 直连 DNS:', directDNS);
            server.type = 'udp';
            server.server = directDNS;
            server.server_port = 53;
            return;
        }
    }
}

async function rewriteConfig(deps: ConfigMergeDeps, newConfig: SingBoxConfigLike): Promise<void> {
    deps.log.info('[Config] rewriteConfig: 注入 DNS，清理未用字段');
    try {
        await updateDNSToConfig(deps, newConfig);
    } catch (error) {
        deps.log.error('[Config] 更新 DNS 配置失败:', error);
        throw error;
    }
    if (newConfig['experimental']) {
        delete newConfig['experimental']['clash_api'];
    }
    // Override the sing-box core log level with the user's preference
    // (default: info). The template ships with `debug` which is noisy
    // and hurts battery; users can bump it back up in the dev page.
    const level = deps.getLogLevel();
    if (!newConfig.log) newConfig.log = {};
    newConfig.log.level = level;
    deps.log.info(`[Config] core log level → ${level}`);
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

    // Collect tags already present in the template to avoid duplicates
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
 * Pure-core pipeline: parse → template → [custom rules] → DNS/log rewrite
 * → TUN exclusions → server-node injection → JSON string.
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
    // Carry the profile's per-platform TUN bypass list into the active config
    // (Android: exclude_package, iOS: route_exclude_address). Platform-split.
    deps.applyTunExclusions(configJson, newConfig);
    return injectServerNodes(configJson, newConfig, deps.log);
}
