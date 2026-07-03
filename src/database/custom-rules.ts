// 用户自定义路由规则的共享结构 + 注入逻辑。
//
// 一条自定义规则是一个 (action, kind, value) 三元组：
//   action ∈ reject | direct | proxy   —— 对匹配到的流量做什么
//   kind   ∈ domain | domain_suffix | ip_cidr —— 如何匹配
//
// 每个 action 保存一个 RuleSet（三个字符串数组）。injectCustomRules 把每个集合
// 合并进模板产出的对应锚点 route rule。
//
// 纯模块：零原生 import，使 node --experimental-strip-types 能直接运行 sibling
// test。

export type RuleAction = 'reject' | 'direct' | 'proxy';
export type RuleKind = 'domain' | 'domain_suffix' | 'ip_cidr';

export interface RuleSet {
    domain: string[];
    domain_suffix: string[];
    ip_cidr: string[];
}

// 固定的迭代 / 显示顺序 = 匹配优先级：reject → direct → proxy。
// sing-box 是 first-match-wins，因此 reject（block）优先于 direct 优先于
// proxy；列表、action 选择器与帮助图例都遵循这一顺序。
export const RULE_ACTIONS: readonly RuleAction[] = ['reject', 'direct', 'proxy'];
export const RULE_KINDS: readonly RuleKind[] = ['domain', 'domain_suffix', 'ip_cidr'];

// 锚点域名是与运行时模板共享的承重契约。模板为每个 action 产出一条携带其锚点
// 域名的 route rule；injectCustomRules 找到该 rule 并把用户的匹配项追加进去。
// 这些字符串必须与模板逐字节一致。
export const ACTION_ANCHOR: Record<RuleAction, string> = {
    reject: 'reject-tag.oneoh.cloud',
    direct: 'direct-tag.oneoh.cloud',
    proxy: 'proxy-tag.oneoh.cloud',
};

export function emptyRuleSet(): RuleSet {
    return { domain: [], domain_suffix: [], ip_cidr: [] };
}

export function isRuleSetEmpty(s: RuleSet): boolean {
    return s.domain.length === 0
        && s.domain_suffix.length === 0
        && s.ip_cidr.length === 0;
}

// 最小结构类型，让 injectCustomRules 保持 `any`-free，同时仍能容纳真实 sing-box
// route rule 携带的众多额外字段。
interface RouteRuleLike {
    domain?: string[];
    domain_suffix?: string[];
    ip_cidr?: string[];
    [k: string]: unknown;
}

interface SingBoxConfigLike {
    route?: { rules?: RouteRuleLike[] };
}

/**
 * 定位锚定给定 action 的 route rule —— 即 `domain` 数组携带该 action 锚点域名
 * 的那一条。配置中没有这样的 rule 时返回 undefined（陈旧的模板快照可能早于某个
 * 锚点）。
 */
export function findAnchorRule(
    config: SingBoxConfigLike,
    action: RuleAction,
): RouteRuleLike | undefined {
    const rules = config?.route?.rules;
    if (!Array.isArray(rules)) return undefined;
    const anchor = ACTION_ANCHOR[action];
    return rules.find((r) => Array.isArray(r.domain) && r.domain.includes(anchor));
}

/** 配置携带锚定给定 action 的 route rule 时为 true。 */
export function hasActionAnchor(config: SingBoxConfigLike, action: RuleAction): boolean {
    return findAnchorRule(config, action) !== undefined;
}

/**
 * 就地把用户自定义规则注入 sing-box 的 route 配置。
 *
 * 对每个集合非空的 action，定位其锚点 route rule（`domain` 数组含该 action 锚点
 * 域名的那条），并把用户的 domain / domain_suffix / ip_cidr 匹配项追加进去。
 *
 * 锚点缺失时静默跳过而非抛错：陈旧的模板快照可能早于某个锚点，而唯一受影响的
 * 窗口是离线首启。被匹配 rule 的 action / outbound 永不改动 —— reject rule 保持
 * action:"reject"，direct 保持 outbound:"direct"，proxy 保持
 * outbound:"ExitGateway"。
 */
export function injectCustomRules(
    config: SingBoxConfigLike,
    sets: Record<RuleAction, RuleSet>,
): void {
    if (!Array.isArray(config?.route?.rules)) return;

    for (const action of RULE_ACTIONS) {
        const set = sets[action];
        if (!set || isRuleSetEmpty(set)) continue;

        const rule = findAnchorRule(config, action);
        if (!rule) continue;

        (rule.domain ??= []).push(...set.domain);
        (rule.domain_suffix ??= []).push(...set.domain_suffix);
        (rule.ip_cidr ??= []).push(...set.ip_cidr);
    }
}

export interface FlatRule {
    action: RuleAction;
    kind: RuleKind;
    value: string;
}

/** 把每个 action 的每个 kind 展开成一个未排序的列表。 */
export function flattenRuleSets(sets: Record<RuleAction, RuleSet>): FlatRule[] {
    const out: FlatRule[] = [];
    for (const action of RULE_ACTIONS) {
        for (const kind of RULE_KINDS) {
            for (const value of sets[action][kind]) {
                out.push({ action, kind, value });
            }
        }
    }
    return out;
}

/**
 * 按 action 优先级（RULE_ACTIONS）、再按 kind（RULE_KINDS）、再按 value 排序。
 * 返回一个新数组 —— 输入保持不变。
 */
export function sortFlatRules(rules: FlatRule[]): FlatRule[] {
    return [...rules].sort((a, b) => {
        const byAction = RULE_ACTIONS.indexOf(a.action) - RULE_ACTIONS.indexOf(b.action);
        if (byAction !== 0) return byAction;
        const byKind = RULE_KINDS.indexOf(a.kind) - RULE_KINDS.indexOf(b.kind);
        if (byKind !== 0) return byKind;
        return a.value.localeCompare(b.value);
    });
}

/** 对 value 做大小写不敏感的子串过滤；空查询返回全部。 */
export function filterFlatRules(rules: FlatRule[], query: string): FlatRule[] {
    const q = query.trim().toLowerCase();
    if (q === '') return rules;
    return rules.filter((r) => r.value.toLowerCase().includes(q));
}
