import {
    ALLOWLAN_STORE_KEY,
    configType,
    ENABLE_BYPASS_ROUTER_STORE_KEY,
    ENABLE_TUN_STORE_KEY,
    STAGE_VERSION_STORE_KEY,
    StageVersionType,
    USE_DHCP_STORE_KEY,
    USER_AGENT_STORE_KEY,
} from '@/definition';
import { getSingBoxMajorVersion } from '@/utils/sing-box-version';
import { emptyRuleSet, RULE_ACTIONS, type RuleAction, type RuleSet } from './custom-rules';
import { kvDelete, kvGet, kvSet } from './kv';

export const LANGUAGE_STORE_KEY = 'language';

// ─── SQLite-backed store wrapper ─────────────────────────────────────────────
// All values are stored as strings in kv_store.
// Non-string writes are JSON-serialised; reads are JSON-parsed where possible
// so that booleans (true/false) and numbers round-trip correctly.
// ─────────────────────────────────────────────────────────────────────────────

const store = {
    /** Synchronous read — returns the parsed value or the raw string. */
    getRaw(key: string): string | null {
        return kvGet(key);
    },

    /** Async read with JSON coercion (booleans, numbers, strings all work). */
    async get(key: string): Promise<any> {
        const raw = kvGet(key);
        if (raw === null || raw === undefined) return null;
        try {
            return JSON.parse(raw);
        } catch {
            // Plain string values that are not valid JSON
            return raw;
        }
    },

    /** Persist a value; non-strings are JSON-serialised. */
    set(key: string, value: any): void {
        if (typeof value === 'string') {
            kvSet(key, value);
        } else {
            kvSet(key, JSON.stringify(value));
        }
    },

    delete(key: string): void {
        kvDelete(key);
    },

    /** No-op — SQLite writes are synchronous, no explicit flush needed. */
    save(): Promise<void> {
        return Promise.resolve();
    },
};

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getStoreValue(key: string, defaultValue?: any): Promise<any> {
    const value = await store.get(key);
    if (defaultValue !== undefined && (value === undefined || value === null || value === '')) {
        console.debug(`[Store] key "${key}" is empty, returning default.`);
        return defaultValue;
    }
    console.debug(`[Store] key "${key}" found.`);
    return value;
}

export async function setStoreValue(key: string, value: any): Promise<void> {
    store.set(key, value);
    await store.save();
}

export const setLanguage = async (language: string) => setStoreValue(LANGUAGE_STORE_KEY, language);

export async function getEnableTun(): Promise<boolean> {
    return Boolean(await store.get(ENABLE_TUN_STORE_KEY));
}

export async function setEnableTun(value: boolean): Promise<void> {
    store.set(ENABLE_TUN_STORE_KEY, value);
}

export async function getAllowLan(): Promise<boolean> {
    return Boolean(await store.get(ALLOWLAN_STORE_KEY));
}

export async function setAllowLan(value: boolean): Promise<void> {
    store.set(ALLOWLAN_STORE_KEY, value);
}


export async function isBypassRouterEnabled(): Promise<boolean> {
    return Boolean(await store.get(ENABLE_BYPASS_ROUTER_STORE_KEY));
}

export async function getUseDHCP(): Promise<boolean> {
    const b = await store.get(USE_DHCP_STORE_KEY);
    return b === undefined || b === null ? false : Boolean(b);
}

export async function setUseDHCP(value: boolean): Promise<void> {
    store.set(USE_DHCP_STORE_KEY, value);
}

export async function setCustomRuleSet(key: RuleAction, config: RuleSet): Promise<void> {
    store.set(`custom_ruleset_${key}`, JSON.stringify(config));
}

export async function getCustomRuleSet(key: RuleAction): Promise<RuleSet> {
    const s = store.getRaw(`custom_ruleset_${key}`);
    if (s) {
        try {
            const config = JSON.parse(s);
            if (config && typeof config === 'object') {
                if (!Array.isArray(config.domain)) config.domain = [];
                if (!Array.isArray(config.domain_suffix)) config.domain_suffix = [];
                if (!Array.isArray(config.ip_cidr)) config.ip_cidr = [];
                return config;
            }
        } catch (e) {
            console.error('[Store] Failed to parse custom ruleset:', e);
        }
    }
    return emptyRuleSet();
}

export async function getAllCustomRuleSets(): Promise<Record<RuleAction, RuleSet>> {
    // Destructure order mirrors RULE_ACTIONS (reject, direct, proxy).
    const [reject, direct, proxy] = await Promise.all(
        RULE_ACTIONS.map((action) => getCustomRuleSet(action)),
    );
    return { reject, direct, proxy };
}

export async function setDirectDNS(dnsServers: string): Promise<void> {
    store.set('direct_dns', dnsServers);
}

export async function getDirectDNS(): Promise<string> {
    const s = store.getRaw('direct_dns');
    return s || '223.5.5.5';
}

export async function getUserAgent(): Promise<string> {
    return (store.getRaw(USER_AGENT_STORE_KEY)) || 'default';
}

export async function setUserAgent(ua: string): Promise<void> {
    store.set(USER_AGENT_STORE_KEY, ua);
}

export async function getConfigTemplateURLKey(mode: configType): Promise<string> {
    return `key-sing-box-${getSingBoxMajorVersion()}-${mode}-template-path`;
}

export async function getConfigTemplateURL(mode: configType): Promise<string> {
    const cacheKey = await getConfigTemplateURLKey(mode);
    const defaultUrl = await getDefaultConfigTemplateURL(mode);
    return (await getStoreValue(cacheKey, defaultUrl)) as string;
}

export async function setConfigTemplateURL(mode: configType, url: string): Promise<void> {
    const cacheKey = await getConfigTemplateURLKey(mode);
    await setStoreValue(cacheKey, url);
}

export async function getDefaultConfigTemplateURL(mode: configType): Promise<string> {
    const remoteUrl = 'https://onebox-updater.oneoh.cloud/conf-template';
    const stageVersion: StageVersionType = await getStoreValue(STAGE_VERSION_STORE_KEY);
    const ver = getSingBoxMajorVersion();

    switch (mode) {
        case 'tun-rules':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/tun-rules.jsonc`;
        case 'tun-global':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/tun-global.jsonc`;
        default:
            throw new Error(`Unsupported config type: ${mode}`);
    }
}
