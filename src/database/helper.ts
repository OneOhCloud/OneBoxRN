import { ExpoOneBox } from '@/modules/expo-onebox';
import { jsLog } from '@/utils/log-sink';
import { applyPlatformTunExclusions } from './apply-tun-exclusions';
import {
    buildSingBoxConfig,
    FALLBACK_DNS,
    type ConfigMergeDeps,
} from './config-merge-core';
import { getConfigTemplate } from './config-template';
import { SBConfig } from './kv';
import { getAllCustomRuleSets, setStoreValue } from './store';

export { extractSystemDns } from './config-merge-core';

// ─── DNS rewrite ─────────────────────────────────────────────────────────────

const BEST_DNS_TIMEOUT_MS = 2000;

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
 * Used by both the merge pipeline (updateDNSToConfig) and the Settings
 * InfoCard. Callers MUST route through here instead of calling
 * ExpoOneBox.getBestDns / setStoreValue('directDNS', …) on their own, so
 * the value in `dns.servers[tag='system'].server` of the merged config
 * stays byte-identical to the value read from KV by the Settings UI.
 * UI callers MUST go through VpnContext.refreshDirectDns — never import
 * this function from a component / screen / hook.
 *
 * Accepted trade-off: accept possible double native probe + double KV write
 * when the merge pipeline (config-merge-core, via the injected
 * resolveDirectDns seam below) and the UI's focus refresh fire
 * concurrently, in exchange for not plumbing the merge pipeline through
 * VpnContext (which would invert a layering: DB → UI context → DB). The race
 * window is bounded (both calls settle within the 2s probe timeout) and both
 * writes converge on the same IP value detected by the same OS query, so
 * last-writer-wins is idempotent in practice.
 */
export async function refreshDirectDns(fallback: string = FALLBACK_DNS): Promise<string> {
    const raw = await getBestDnsWithTimeout(fallback);
    const trimmed = raw.trim() || FALLBACK_DNS;
    await setStoreValue('directDNS', trimmed);
    return trimmed;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

// Merge pipeline lives in config-merge-core.ts (pure, golden-tested); this is
// its one production wiring point. `resolveDirectDns: refreshDirectDns` is
// the directDNS byte-identity contract wiring (see the comment above
// refreshDirectDns).
const mergeDeps: ConfigMergeDeps = {
    getTemplate: getConfigTemplate,
    getCustomRuleSets: getAllCustomRuleSets,
    resolveDirectDns: refreshDirectDns,
    getLogLevel: SBConfig.getLogLevel,
    applyTunExclusions: applyPlatformTunExclusions,
    log: jsLog,
};

export async function getProcessedConfig(): Promise<string> {
    const mode = SBConfig.getMode();
    const configContent = SBConfig.getConfigContent();
    if (!configContent) throw new Error('No config content found');
    if (mode !== 'tun-rules' && mode !== 'tun-global') {
        throw new Error(`Unsupported config type: ${mode}`);
    }
    return buildSingBoxConfig(mergeDeps, { mode, userConfigContent: configContent });
}
