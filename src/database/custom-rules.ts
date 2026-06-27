// Shared shape + injection logic for user custom routing rules.
//
// A custom rule is an (action, kind, value) triple:
//   action ∈ reject | direct | proxy   — what to do with matched traffic
//   kind   ∈ domain | domain_suffix | ip_cidr — how to match it
//
// Per action we keep one RuleSet (three string arrays). injectCustomRules
// merges each set into the matching anchor route rule emitted by the template.
//
// Pure module: ZERO native imports so node --experimental-strip-types can run
// its sibling test directly.

export type RuleAction = 'reject' | 'direct' | 'proxy';
export type RuleKind = 'domain' | 'domain_suffix' | 'ip_cidr';

export interface RuleSet {
    domain: string[];
    domain_suffix: string[];
    ip_cidr: string[];
}

// Fixed iteration / display order = match priority: reject → direct → proxy.
// sing-box is first-match-wins, so reject (block) outranks direct outranks
// proxy; the list, the action pickers and the help legend all follow this.
export const RULE_ACTIONS: readonly RuleAction[] = ['reject', 'direct', 'proxy'];
export const RULE_KINDS: readonly RuleKind[] = ['domain', 'domain_suffix', 'ip_cidr'];

// Anchor domains are load-bearing contracts shared with the runtime template.
// The template emits one route rule per action carrying its anchor domain;
// injectCustomRules finds that rule and appends the user's matchers into it.
// The strings must match the template byte-for-byte.
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

// Minimal structural types so injectCustomRules stays `any`-free while still
// tolerating the many extra fields a real sing-box route rule carries.
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
 * Locate the route rule that anchors a given action — the one whose `domain`
 * array carries that action's anchor domain. Returns undefined when the config
 * has no such rule (a stale template snapshot may predate an anchor).
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

/** True when the config carries the route rule anchoring the given action. */
export function hasActionAnchor(config: SingBoxConfigLike, action: RuleAction): boolean {
    return findAnchorRule(config, action) !== undefined;
}

/**
 * Inject user custom rules into a sing-box route config, in place.
 *
 * For each action with a non-empty set, locate the anchor route rule (the
 * one whose `domain` array contains the action's anchor domain) and append
 * the user's domain / domain_suffix / ip_cidr matchers into it.
 *
 * A missing anchor is skipped silently rather than throwing: a stale template
 * snapshot may predate an anchor, and offline first-launch is the only window
 * that affects. The matched rule's action / outbound is never touched — reject
 * rules keep action:"reject", direct keep outbound:"direct", proxy keep
 * outbound:"ExitGateway".
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

/** Expand every kind of every action into a single unsorted list. */
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
 * Sort by action priority (RULE_ACTIONS), then kind (RULE_KINDS), then value.
 * Returns a NEW array — the input is left untouched.
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

/** Case-insensitive substring filter on value; a blank query returns all. */
export function filterFlatRules(rules: FlatRule[], query: string): FlatRule[] {
    const q = query.trim().toLowerCase();
    if (q === '') return rules;
    return rules.filter((r) => r.value.toLowerCase().includes(q));
}
