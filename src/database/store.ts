import { emptyRuleSet, RULE_ACTIONS, type RuleAction, type RuleSet } from './custom-rules';
import { kvDelete, kvGet, kvSet } from './kv';

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

export async function deleteStoreValue(key: string): Promise<void> {
    store.delete(key);
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
