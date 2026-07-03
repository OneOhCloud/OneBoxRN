import { emptyRuleSet, RULE_ACTIONS, type RuleAction, type RuleSet } from './custom-rules';
import { kvDelete, kvGet, kvSet } from './kv';

// ─── SQLite 支撑的 store 包装 ─────────────────────────────────────────────
// 所有值都以字符串形式存入 kv_store。
// 非字符串写入会做 JSON 序列化；读取时尽量做 JSON 解析，使布尔值（true/false）
// 与数字能正确往返。
// ─────────────────────────────────────────────────────────────────────────────

const store = {
    /** 同步读取 —— 返回解析后的值或原始字符串。 */
    getRaw(key: string): string | null {
        return kvGet(key);
    },

    /** 异步读取并做 JSON 归一化（布尔、数字、字符串都适用）。 */
    async get(key: string): Promise<any> {
        const raw = kvGet(key);
        if (raw === null || raw === undefined) return null;
        try {
            return JSON.parse(raw);
        } catch {
            // 非合法 JSON 的纯字符串值
            return raw;
        }
    },

    /** 持久化一个值；非字符串会做 JSON 序列化。 */
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

    /** 空操作 —— SQLite 写入是同步的，无需显式 flush。 */
    save(): Promise<void> {
        return Promise.resolve();
    },
};

// ─── 公开 API ──────────────────────────────────────────────────────────────

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
    // 解构顺序对应 RULE_ACTIONS（reject, direct, proxy）。
    const [reject, direct, proxy] = await Promise.all(
        RULE_ACTIONS.map((action) => getCustomRuleSet(action)),
    );
    return { reject, direct, proxy };
}
