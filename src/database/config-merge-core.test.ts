import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildSingBoxConfig,
    extractSystemDns,
    FALLBACK_DNS,
    URLTEST_PROBE_URL,
    type ConfigMergeDeps,
    type SingBoxConfigLike,
} from './config-merge-core.ts';
import { emptyRuleSet, type RuleAction, type RuleSet } from './custom-rules.ts';
import { mergeUserTunField } from './tun-exclusions.ts';

// ─── 测试数据 ─────────────────────────────────────────────────────────────────
// 合成数据 —— 真正的内置模板（template/generated.ts）被 gitignore，绝不能在
// 这里 import。此 fixture 复刻其结构契约：system/remote DNS server、一个 tun
// inbound、[direct, selector@1, urltest@2] outbound 组、每个 action 一条锚点
// route rule，以及一个携带 clash_api 的 experimental section。

const TEMPLATE = {
    log: { disabled: false, level: 'debug', timestamp: false },
    dns: {
        servers: [
            { tag: 'system', type: 'udp', server: '223.5.5.5', server_port: 53, connect_timeout: '5s' },
            { tag: 'remote', type: 'fakeip', inet4_range: '198.18.0.0/15' },
        ],
        final: 'remote',
    },
    inbounds: [
        { tag: 'tun', type: 'tun', stack: 'gvisor', route_exclude_address: ['10.0.0.0/8'] },
    ],
    outbounds: [
        { tag: 'direct', type: 'direct' },
        { tag: 'ExitGateway', type: 'selector', outbounds: ['auto'] },
        { tag: 'auto', type: 'urltest', outbounds: [] },
    ],
    route: {
        rules: [
            { domain: ['reject-tag.oneoh.cloud'], action: 'reject' },
            { domain: ['direct-tag.oneoh.cloud'], outbound: 'direct' },
            { domain: ['proxy-tag.oneoh.cloud'], outbound: 'ExitGateway' },
        ],
        final: 'ExitGateway',
    },
    experimental: {
        clash_api: { external_controller: '127.0.0.1:9090' },
        cache_file: { enabled: true },
    },
};

// 用户配置文件：两个可注入节点、一个与模板冲突的 tag（'auto'）、全部五种被
// 排除的 outbound 类型，以及一个 route_exclude_address 与模板默认值半重叠的
// tun inbound。
const USER_CONFIG_CONTENT = JSON.stringify({
    outbounds: [
        { tag: 'node-a', type: 'vless', server: 'a.example.invalid' },
        { tag: 'node-b', type: 'trojan', server: 'b.example.invalid' },
        { tag: 'auto', type: 'vmess' },
        { tag: 'sel', type: 'selector' },
        { tag: 'ut', type: 'urltest' },
        { tag: 'dir', type: 'direct' },
        { tag: 'blk', type: 'block' },
        { tag: 'd', type: 'dns' },
    ],
    inbounds: [
        {
            tag: 'tun',
            type: 'tun',
            route_exclude_address: ['192.168.50.0/24', '10.0.0.0/8'],
        },
    ],
});

function ruleSets(): Record<RuleAction, RuleSet> {
    return {
        reject: { domain: ['ads.example.invalid'], domain_suffix: ['.track.invalid'], ip_cidr: [] },
        direct: emptyRuleSet(),
        proxy: { domain: [], domain_suffix: [], ip_cidr: ['203.0.113.0/24'] },
    };
}

// ─── Golden 基准 ───────────────────────────────────────────────────────────────
// 这些 golden 逐项锁定合并流水线的每步变换：log.level debug→info；system DNS
// server 改写为 resolver 值且保持 key 顺序；TUN 排除项并集去重（模板默认值在
// 前）；selector/urltest 的 tag 列表扩展；节点追加时 domain_resolver 排在 key
// 顺序最后；重复的 'auto' tag 与全部五种被排除类型被丢弃；自定义规则追加进锚点
// rule（`??=` 会创建缺失的数组，含空数组）；clash_api 被删除但 experimental
// section 保留。

const GOLDEN_TUN_RULES = '{"log":{"disabled":false,"level":"info","timestamp":false},"dns":{"servers":[{"tag":"system","type":"udp","server":"1.2.3.4","server_port":53,"connect_timeout":"5s"},{"tag":"remote","type":"fakeip","inet4_range":"198.18.0.0/15"}],"final":"remote"},"inbounds":[{"tag":"tun","type":"tun","stack":"gvisor","route_exclude_address":["10.0.0.0/8","192.168.50.0/24"]}],"outbounds":[{"tag":"direct","type":"direct"},{"tag":"ExitGateway","type":"selector","outbounds":["auto","node-a","node-b"]},{"tag":"auto","type":"urltest","outbounds":["node-a","node-b"],"url":"http://www.gstatic.com/generate_204"},{"tag":"node-a","type":"vless","server":"a.example.invalid","domain_resolver":"system"},{"tag":"node-b","type":"trojan","server":"b.example.invalid","domain_resolver":"system"}],"route":{"rules":[{"domain":["reject-tag.oneoh.cloud","ads.example.invalid"],"action":"reject","domain_suffix":[".track.invalid"],"ip_cidr":[]},{"domain":["direct-tag.oneoh.cloud"],"outbound":"direct"},{"domain":["proxy-tag.oneoh.cloud"],"outbound":"ExitGateway","domain_suffix":[],"ip_cidr":["203.0.113.0/24"]}],"final":"ExitGateway"},"experimental":{"cache_file":{"enabled":true}}}';

const GOLDEN_TUN_GLOBAL = '{"log":{"disabled":false,"level":"info","timestamp":false},"dns":{"servers":[{"tag":"system","type":"udp","server":"1.2.3.4","server_port":53,"connect_timeout":"5s"},{"tag":"remote","type":"fakeip","inet4_range":"198.18.0.0/15"}],"final":"remote"},"inbounds":[{"tag":"tun","type":"tun","stack":"gvisor","route_exclude_address":["10.0.0.0/8","192.168.50.0/24"]}],"outbounds":[{"tag":"direct","type":"direct"},{"tag":"ExitGateway","type":"selector","outbounds":["auto","node-a","node-b"]},{"tag":"auto","type":"urltest","outbounds":["node-a","node-b"],"url":"http://www.gstatic.com/generate_204"},{"tag":"node-a","type":"vless","server":"a.example.invalid","domain_resolver":"system"},{"tag":"node-b","type":"trojan","server":"b.example.invalid","domain_resolver":"system"}],"route":{"rules":[{"domain":["reject-tag.oneoh.cloud"],"action":"reject"},{"domain":["direct-tag.oneoh.cloud"],"outbound":"direct"},{"domain":["proxy-tag.oneoh.cloud"],"outbound":"ExitGateway"}],"final":"ExitGateway"},"experimental":{"cache_file":{"enabled":true}}}';

// ─── 测试脚手架 ─────────────────────────────────────────────────────────────────

interface Harness {
    deps: ConfigMergeDeps;
    calls: string[];
    logLines: [string, unknown[]][];
    resolveDirectDnsArgs: string[];
}

function makeHarness(overrides?: {
    template?: unknown;
    getTemplate?: ConfigMergeDeps['getTemplate'];
    resolveDirectDns?: ConfigMergeDeps['resolveDirectDns'];
}): Harness {
    const calls: string[] = [];
    const logLines: [string, unknown[]][] = [];
    const resolveDirectDnsArgs: string[] = [];
    const template = overrides?.template ?? TEMPLATE;
    const deps: ConfigMergeDeps = {
        getTemplate: overrides?.getTemplate ?? ((mode) => {
            calls.push(`getTemplate:${mode}`);
            // 每次调用返回全新的对象图 —— 模仿 templateMemoryCache。
            return Promise.resolve(JSON.parse(JSON.stringify(template)) as SingBoxConfigLike);
        }),
        getCustomRuleSets: () => {
            calls.push('getCustomRuleSets');
            return Promise.resolve(ruleSets());
        },
        resolveDirectDns: overrides?.resolveDirectDns ?? ((fallback) => {
            calls.push('resolveDirectDns');
            resolveDirectDnsArgs.push(fallback);
            return Promise.resolve('1.2.3.4');
        }),
        getLogLevel: () => 'info',
        applyTunExclusions: (u, t) => {
            calls.push('applyTunExclusions');
            // iOS 风格字段；按平台拆分的变体只是字段名不同，已由
            // tun-exclusions.test.ts 覆盖。
            mergeUserTunField(u, t, 'route_exclude_address');
        },
        log: {
            info: (...args: unknown[]) => logLines.push(['info', args]),
            warn: (...args: unknown[]) => logLines.push(['warn', args]),
            error: (...args: unknown[]) => logLines.push(['error', args]),
        },
    };
    return { deps, calls, logLines, resolveDirectDnsArgs };
}

// ─── 用例 ────────────────────────────────────────────────────────────────────

describe('buildSingBoxConfig', () => {
    it('tun-rules: golden master byte identity', async () => {
        const h = makeHarness();
        const out = await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT });
        assert.equal(out, GOLDEN_TUN_RULES);
    });

    it('tun-global: golden master byte identity, custom rule sets never read', async () => {
        const h = makeHarness();
        const out = await buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT });
        assert.equal(out, GOLDEN_TUN_GLOBAL);
        assert.ok(!h.calls.includes('getCustomRuleSets'));
    });

    it('directDNS contract: merged config carries exactly the resolver value', async () => {
        const h = makeHarness();
        const out = await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT });
        assert.equal(extractSystemDns(out), '1.2.3.4');
    });

    it('resolver receives the template system server as fallback', async () => {
        const h = makeHarness();
        await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT });
        assert.deepEqual(h.resolveDirectDnsArgs, ['223.5.5.5']);
    });

    it('blank template system server falls back to FALLBACK_DNS', async () => {
        const template = JSON.parse(JSON.stringify(TEMPLATE)) as typeof TEMPLATE;
        template.dns.servers[0].server = '  ';
        const h = makeHarness({ template });
        await buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT });
        assert.deepEqual(h.resolveDirectDnsArgs, [FALLBACK_DNS]);
    });

    it('no system server: resolver never called, dns section byte-unchanged', async () => {
        const template = JSON.parse(JSON.stringify(TEMPLATE)) as typeof TEMPLATE;
        template.dns.servers = template.dns.servers.filter((s) => s.tag !== 'system');
        const h = makeHarness({ template });
        const out = await buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT });
        assert.ok(!h.calls.includes('resolveDirectDns'));
        assert.deepEqual(JSON.parse(out).dns, template.dns);
    });

    it('resolver rejection: same error rethrown, DNS failure logged at error level', async () => {
        const boom = new Error('probe failed');
        const h = makeHarness({ resolveDirectDns: () => Promise.reject(boom) });
        await assert.rejects(
            buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT }),
            boom,
        );
        assert.deepEqual(
            h.logLines.filter(([level]) => level === 'error'),
            [['error', ['[Config] failed to update DNS config:', boom]]],
        );
    });

    it('malformed user JSON rejects', async () => {
        const h = makeHarness();
        await assert.rejects(
            buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: 'not json' }),
            SyntaxError,
        );
    });

    it('template without a log section gets one appended carrying the level', async () => {
        const template = JSON.parse(JSON.stringify(TEMPLATE)) as Record<string, unknown>;
        delete template.log;
        const h = makeHarness({ template });
        const out = JSON.parse(await buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT }));
        assert.deepEqual(out.log, { level: 'info' });
        // 新建的 section 追加在已有 key 之后 —— 结构断言，非 golden。
        assert.equal(Object.keys(out).at(-1), 'log');
    });

    it('urltest probe URL: a template-provided url is overwritten by the single source', async () => {
        // 模板（外部 conf-template 仓库）自带 https google 探测；合并期覆写是
        // 探测口径的单一来源——不依赖模板变更即可保证 http gstatic 口径。
        const template = JSON.parse(JSON.stringify(TEMPLATE)) as SingBoxConfigLike;
        template.outbounds![2].url = 'https://www.google.com/generate_204';
        const h = makeHarness({ template });
        const out = JSON.parse(
            await buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT }),
        ) as SingBoxConfigLike;
        const urltestGroups = out.outbounds!.filter((o) => o.type === 'urltest');
        assert.equal(urltestGroups.length, 1);
        assert.equal(urltestGroups[0].url, URLTEST_PROBE_URL);
    });

    it('log transcript: exact ordered lines for tun-rules', async () => {
        const h = makeHarness();
        await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT });
        assert.deepEqual(h.logLines, [
            ['info', ['[Config] Building tun-rules config']],
            ['info', ['[Config] TUN Stack:', 'gvisor']],
            ['info', ['[Config] rewriteConfig: inject DNS, strip unused fields']],
            ['info', ['[Config] direct DNS:', '1.2.3.4']],
            ['info', ['[Config] core log level → info']],
            ['info', ['[Config] urltest probe → http://www.gstatic.com/generate_204']],
            ['warn', ['[Config] Skipping server with duplicate tag: "auto"']],
        ]);
    });

    it('log transcript: exact ordered lines for tun-global', async () => {
        const h = makeHarness();
        await buildSingBoxConfig(h.deps, { mode: 'tun-global', userConfigContent: USER_CONFIG_CONTENT });
        assert.deepEqual(h.logLines, [
            ['info', ['[Config] Building tun-global config']],
            ['info', ['[Config] rewriteConfig: inject DNS, strip unused fields']],
            ['info', ['[Config] direct DNS:', '1.2.3.4']],
            ['info', ['[Config] core log level → info']],
            ['info', ['[Config] urltest probe → http://www.gstatic.com/generate_204']],
            ['warn', ['[Config] Skipping server with duplicate tag: "auto"']],
        ]);
    });

    it('deps call order: template → rule sets → DNS probe → TUN exclusions', async () => {
        const h = makeHarness();
        await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT });
        assert.deepEqual(h.calls, [
            'getTemplate:tun-rules',
            'getCustomRuleSets',
            'resolveDirectDns',
            'applyTunExclusions',
        ]);
    });

    it('mutation-in-place: a shared template reference accumulates custom rules across builds', async () => {
        // 说明为什么 deps.getTemplate 必须每次返回全新的对象图（template-cache.ts
        // 变更安全契约的需求侧）。节点注入有重复 tag 卫语句兜底，但自定义规则
        // 会无条件追加进锚点 rule。
        const shared = JSON.parse(JSON.stringify(TEMPLATE)) as SingBoxConfigLike;
        const h = makeHarness({ getTemplate: () => Promise.resolve(shared) });
        await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT });
        const second = JSON.parse(
            await buildSingBoxConfig(h.deps, { mode: 'tun-rules', userConfigContent: USER_CONFIG_CONTENT }),
        );
        assert.deepEqual(second.route.rules[0].domain, [
            'reject-tag.oneoh.cloud',
            'ads.example.invalid',
            'ads.example.invalid',
        ]);
    });
});

describe('extractSystemDns', () => {
    it('reads the system server back out of a merged config', () => {
        assert.equal(extractSystemDns(GOLDEN_TUN_RULES), '1.2.3.4');
    });

    it('returns null on malformed JSON or missing section', () => {
        assert.equal(extractSystemDns('not json'), null);
        assert.equal(extractSystemDns('{}'), null);
    });
});
