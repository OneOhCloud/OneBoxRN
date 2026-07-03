import { ExpoOneBox } from '@/modules/expo-onebox';
import { jsLog } from '@/utils/log-sink';
import { applyPlatformTunExclusions } from './apply-tun-exclusions';
import {
    buildSingBoxConfig,
    FALLBACK_DNS,
    type ConfigMergeDeps,
} from './config-merge-core';
import { getConfigTemplate } from './config-template';
import { ProfileConfig } from './kv';
import { getAllCustomRuleSets, setStoreValue } from './store';

export { extractSystemDns } from './config-merge-core';

// ─── DNS 改写 ─────────────────────────────────────────────────────────────

const BEST_DNS_TIMEOUT_MS = 2000;

async function getBestDnsWithTimeout(fallback: string): Promise<string> {
    try {
        return await Promise.race([
            ExpoOneBox.getBestDns(),
            new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error(`getBestDns timed out (${BEST_DNS_TIMEOUT_MS}ms)`)), BEST_DNS_TIMEOUT_MS)
            ),
        ]);
    } catch (e) {
        jsLog.warn('[Config] getBestDns failed or timed out, using fallback DNS:', fallback, e);
        return fallback;
    }
}

/**
 * "direct" DNS server 的单一来源。
 *
 * 合并流水线（updateDNSToConfig）与 Settings InfoCard 都用它。调用方必须经由
 * 此函数，而非各自调用 ExpoOneBox.getBestDns / setStoreValue('directDNS', …)，
 * 以保证合并后配置里 `dns.servers[tag='system'].server` 的值与 Settings UI 从
 * KV 读到的值逐字节一致。UI 调用方必须走 VpnContext.refreshDirectDns —— 绝不
 * 从 component / screen / hook 直接 import 本函数。
 *
 * 已接受的权衡：当合并流水线（config-merge-core，经下方注入的 resolveDirectDns
 * 接缝）与 UI 的 focus 刷新并发触发时，容许一次重复的原生探测 + 重复 KV 写入，
 * 以换取不必把合并流水线接进 VpnContext（那会颠倒分层：DB → UI context → DB）。
 * 竞争窗口有界（两次调用都在 2s 探测超时内收敛），且两次写入都收敛到同一次 OS
 * 查询得到的同一个 IP 值，因此 last-writer-wins 在实践中是幂等的。
 */
export async function refreshDirectDns(fallback: string = FALLBACK_DNS): Promise<string> {
    const raw = await getBestDnsWithTimeout(fallback);
    const trimmed = raw.trim() || FALLBACK_DNS;
    await setStoreValue('directDNS', trimmed);
    return trimmed;
}

// ─── 入口 ─────────────────────────────────────────────────────────────

// 合并流水线在 config-merge-core.ts（纯核心，golden 覆盖）；这里是它唯一的
// 生产装配点。`resolveDirectDns: refreshDirectDns` 是 directDNS 逐字节一致
// 契约的装配（见 refreshDirectDns 上方的注释）。
const mergeDeps: ConfigMergeDeps = {
    getTemplate: getConfigTemplate,
    getCustomRuleSets: getAllCustomRuleSets,
    resolveDirectDns: refreshDirectDns,
    getLogLevel: ProfileConfig.getLogLevel,
    applyTunExclusions: applyPlatformTunExclusions,
    log: jsLog,
};

export async function getProcessedConfig(): Promise<string> {
    const mode = ProfileConfig.getMode();
    const configContent = ProfileConfig.getConfigContent();
    if (!configContent) throw new Error('No config content found');
    if (mode !== 'tun-rules' && mode !== 'tun-global') {
        throw new Error(`Unsupported config type: ${mode}`);
    }
    return buildSingBoxConfig(mergeDeps, { mode, userConfigContent: configContent });
}
