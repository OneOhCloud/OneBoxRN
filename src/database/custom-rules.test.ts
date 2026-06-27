import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    filterFlatRules,
    flattenRuleSets,
    injectCustomRules,
    sortFlatRules,
    type FlatRule,
    type RuleAction,
    type RuleSet,
} from './custom-rules.ts';

// A type alias (not an interface) so it gains an implicit index signature and
// stays assignable to the merger's structural RouteRuleLike.
type TestRule = {
    domain?: string[];
    domain_suffix?: string[];
    ip_cidr?: string[];
    action?: string;
    outbound?: string;
};
type TestConfig = { route: { rules: TestRule[] } };

// Mirrors the runtime template's three anchor rules (generated.ts ~183-206).
function fixtureConfig(): TestConfig {
    return {
        route: {
            rules: [
                { domain: ['reject-tag.oneoh.cloud'], domain_suffix: [], ip_cidr: [], action: 'reject' },
                { domain: ['direct-tag.oneoh.cloud'], domain_suffix: [], ip_cidr: [], outbound: 'direct' },
                { domain: ['proxy-tag.oneoh.cloud'], domain_suffix: [], ip_cidr: [], outbound: 'ExitGateway' },
            ],
        },
    };
}

function set(partial: Partial<RuleSet>): RuleSet {
    return { domain: [], domain_suffix: [], ip_cidr: [], ...partial };
}

function emptySets(): Record<RuleAction, RuleSet> {
    return { reject: set({}), direct: set({}), proxy: set({}) };
}

test('each action injects into its own anchor without touching action/outbound', () => {
    const config = fixtureConfig();
    injectCustomRules(config, {
        reject: set({ domain: ['ads.test'] }),
        direct: set({ domain_suffix: ['.lan'] }),
        proxy: set({ ip_cidr: ['1.2.3.0/24'] }),
    });

    const [reject, direct, proxy] = config.route.rules;
    assert.deepEqual(reject.domain, ['reject-tag.oneoh.cloud', 'ads.test']);
    assert.equal(reject.action, 'reject');

    assert.deepEqual(direct.domain_suffix, ['.lan']);
    assert.equal(direct.outbound, 'direct');

    assert.deepEqual(proxy.ip_cidr, ['1.2.3.0/24']);
    assert.equal(proxy.outbound, 'ExitGateway');
});

test('empty set is skipped — anchor arrays stay untouched', () => {
    const config = fixtureConfig();
    injectCustomRules(config, emptySets());
    for (const rule of config.route.rules) {
        assert.deepEqual(rule.domain?.length, 1);
        assert.deepEqual(rule.domain_suffix, []);
        assert.deepEqual(rule.ip_cidr, []);
    }
});

test('missing anchor does not throw and changes nothing', () => {
    const config: TestConfig = { route: { rules: [{ domain: ['unrelated.example'], outbound: 'direct' }] } };
    assert.doesNotThrow(() =>
        injectCustomRules(config, { ...emptySets(), proxy: set({ domain: ['x.test'] }) }),
    );
    assert.deepEqual(config.route.rules[0].domain, ['unrelated.example']);
});

test('anchor lacking domain_suffix/ip_cidr keys gets them created defensively', () => {
    const config: TestConfig = { route: { rules: [{ domain: ['reject-tag.oneoh.cloud'], action: 'reject' }] } };
    injectCustomRules(config, {
        ...emptySets(),
        reject: set({ domain: ['a.test'], domain_suffix: ['.b.test'], ip_cidr: ['9.9.9.9'] }),
    });
    const rule = config.route.rules[0];
    assert.deepEqual(rule.domain, ['reject-tag.oneoh.cloud', 'a.test']);
    assert.deepEqual(rule.domain_suffix, ['.b.test']);
    assert.deepEqual(rule.ip_cidr, ['9.9.9.9']);
});

test('a config without route.rules is a no-op', () => {
    assert.doesNotThrow(() => injectCustomRules({}, emptySets()));
});

test('flattenRuleSets + sortFlatRules order by action, then kind, then value', () => {
    const flat = flattenRuleSets({
        reject: set({ domain: ['z.reject'], ip_cidr: ['8.8.8.8'] }),
        direct: set({ domain_suffix: ['.b.direct', '.a.direct'] }),
        proxy: set({ domain: ['p.proxy'] }),
    });
    const sorted = sortFlatRules(flat).map((r: FlatRule) => `${r.action}:${r.kind}:${r.value}`);
    assert.deepEqual(sorted, [
        'reject:domain:z.reject',
        'reject:ip_cidr:8.8.8.8',
        'direct:domain_suffix:.a.direct',
        'direct:domain_suffix:.b.direct',
        'proxy:domain:p.proxy',
    ]);
});

test('sortFlatRules returns a new array, leaving the input untouched', () => {
    const input: FlatRule[] = [
        { action: 'proxy', kind: 'domain', value: 'b' },
        { action: 'reject', kind: 'domain', value: 'a' },
    ];
    const sorted = sortFlatRules(input);
    assert.notEqual(sorted, input);
    assert.equal(input[0].action, 'proxy');
    assert.equal(sorted[0].action, 'reject');
});

test('filterFlatRules is case-insensitive and blank query returns all', () => {
    const rules: FlatRule[] = [
        { action: 'reject', kind: 'domain', value: 'Ads.Example' },
        { action: 'proxy', kind: 'domain', value: 'video.test' },
    ];
    assert.deepEqual(filterFlatRules(rules, 'ADS').map((r) => r.value), ['Ads.Example']);
    assert.deepEqual(filterFlatRules(rules, '   ').map((r) => r.value), ['Ads.Example', 'video.test']);
});
