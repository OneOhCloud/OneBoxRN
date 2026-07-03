/**
 * 导入流程的入口级测试用例。
 *
 * 每个用例针对导入入口链（QR 解析 → hash → allowlist 匹配 → VPN apply）中
 * 一个外部可观察的行为。用例刻意绕开 ConfigScreen 的渲染循环，直接调用底层
 * 构件，好让回归产生一个定点失败，而非笼统的"导入坏了"。
 */
import { resolveQRData } from '@/components/ui/camera-qr';
import {
    createImportFlowMachine,
    type ImportFlowDeps,
    type ImportFlowMachine,
    type ImportPhase,
} from '@/hooks/import-flow-machine';
import type { Profile } from '@/database/profile-store-core';
import type { ConfigFetchResult } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { hostnameMatchesAnyAllowlist, sha256Hex } from '@/utils/domain-suffix';

import { fakeVpnAsActions, raceWithTimeout } from './mocks';
import {
    expect,
    expectEqual,
    expectThrows,
    TestCase,
    type TestContext,
} from './runner';

// ASCII 字符串 "abc" 的 SHA-256 —— 用作已知向量的金丝雀。
// 一旦它变了，说明 crypto 实现出了真正的 bug。
const SHA256_OF_ABC =
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

// allowlist 测试用的 fixture 主机名。绝不能与真实的编译期 allowlist 条目相撞
// —— 因此用明显虚构的 TLD。
const FIXTURE_PARENT   = 'fixture.invalid';
const FIXTURE_CHILD    = 'child.fixture.invalid';
const FIXTURE_UNRELATED = 'other.invalid';

// ─── 解析 / 识别 ─────────────────────────────────────────────────────

const parseSchemeWithApply: TestCase = {
    id: 'parse-scheme-with-apply',
    name: 'resolveQRData accepts scheme URL with apply=1',
    group: 'parse',
    async run(ctx) {
        const raw = 'oneoh-networktools://config?data=aGVsbG8=&apply=1';
        const out = resolveQRData(raw);
        ctx.log(`raw=${raw}`);
        ctx.log(`out=${JSON.stringify(out)}`);
        expect(out !== null, 'expected non-null result');
        expectEqual(out!.data, 'aGVsbG8=', 'data');
        expectEqual(out!.apply, '1', 'apply');
    },
};

const parseSchemeWithoutApply: TestCase = {
    id: 'parse-scheme-without-apply',
    name: 'resolveQRData accepts scheme URL without apply',
    group: 'parse',
    async run(ctx) {
        const out = resolveQRData('oneoh-networktools://config?data=aGVsbG8=');
        ctx.log(`out=${JSON.stringify(out)}`);
        expect(out !== null, 'expected non-null result');
        expectEqual(out!.data, 'aGVsbG8=', 'data');
        expectEqual(out!.apply, undefined, 'apply');
    },
};

const parsePlainHttps: TestCase = {
    id: 'parse-plain-https',
    name: 'resolveQRData base64-encodes a plain https URL',
    group: 'parse',
    async run(ctx) {
        const raw = 'https://example.invalid/sub/abc';
        const out = resolveQRData(raw);
        ctx.log(`out=${JSON.stringify(out)}`);
        expect(out !== null, 'expected non-null result');
        // `atob` 往返证明下游可以正常解码。
        expectEqual(atob(out!.data), raw, 'decoded');
        expectEqual(out!.apply, undefined, 'apply');
    },
};

const parseGarbage: TestCase = {
    id: 'parse-garbage',
    name: 'resolveQRData rejects unrecognized text',
    group: 'parse',
    async run(ctx) {
        const out = resolveQRData('hello world this is not a url');
        ctx.log(`out=${JSON.stringify(out)}`);
        expectEqual(out, null, 'out');
    },
};

const parseSpecialBase64: TestCase = {
    id: 'parse-base64-special-chars',
    name: 'base64 with "/" and "==" round-trips through QR→router→atob',
    group: 'parse',
    async run(ctx) {
        // 模拟真实世界中会出问题的 QR 载荷：base64 内部含 "/"、结尾带 "==" 填充。
        const innerUrl = 'https://config.example.invalid/sub/ea759de3-fb03-4371?protocol=tuic';
        const base64 = btoa(innerUrl);
        expect(base64.includes('/'), 'fixture sanity: base64 must contain "/"');
        expect(base64.endsWith('=='), 'fixture sanity: base64 must end with "=="');

        // 第 1 步：扫描器解析 scheme URL。
        const scanned = resolveQRData(`oneoh-networktools://config?data=${base64}&apply=1`);
        expect(scanned !== null, 'scanner parse failed');
        expectEqual(scanned!.data, base64, 'scanner data');
        expectEqual(scanned!.apply, '1', 'scanner apply');

        // 第 2 步：URL 编码（`router.push` 会做的事）。
        const encoded = encodeURIComponent(scanned!.data);
        // 第 3 步：经 URL API 解码（Expo Router 在另一端会做的事）。
        const u = new URL(`http://dummy/config?data=${encoded}&apply=1`);
        const backAtConfig = u.searchParams.get('data');
        expectEqual(backAtConfig, base64, 'router round-trip');

        // 第 4 步：atob。
        expectEqual(atob(backAtConfig!), innerUrl, 'final atob');
        ctx.log(`round-trip ok, base64Bytes=${base64.length}`);
    },
};

// ─── Crypto ──────────────────────────────────────────────────────────────────

const cryptoSha256KnownDigest: TestCase = {
    id: 'crypto-sha256-known-digest',
    name: 'sha256Hex("abc") matches NIST vector',
    group: 'crypto',
    async run(ctx) {
        const hex = await sha256Hex('abc');
        ctx.log(`hex=${hex}`);
        expectEqual(hex, SHA256_OF_ABC, 'digest');
    },
};

const cryptoSha256Deterministic: TestCase = {
    id: 'crypto-sha256-deterministic',
    name: 'sha256Hex is deterministic across concurrent calls',
    group: 'crypto',
    async run(ctx) {
        const [a, b, c] = await Promise.all([
            sha256Hex('same-input'),
            sha256Hex('same-input'),
            sha256Hex('same-input'),
        ]);
        ctx.log(`a=${a.slice(0, 16)}..., b===a? ${b === a}, c===a? ${c === a}`);
        expectEqual(a.length, 64, 'hex length');
        expectEqual(b, a, 'second call');
        expectEqual(c, a, 'third call');
    },
};

const cryptoExpoModuleLinked: TestCase = {
    id: 'crypto-expo-module-linked',
    name: 'expo-crypto native module loads and computes a digest',
    group: 'crypto',
    async run(ctx) {
        // 直连原生的路径。若这里失败，`sha256Hex` 的 fallback 分支在 RN 上
        // 也会失败（RN 没有 `crypto.subtle`）。目的是用清晰的信息暴露 link /
        // prebuild 的破损，而非让它在真实流程里伪装成笼统的"verify 卡住"症状。
        let Crypto;
        try {
            Crypto = await import('expo-crypto');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `expo-crypto import failed — run \`make prebuild\` and rebuild the native app. Underlying: ${msg}`,
            );
        }
        ctx.log('expo-crypto imported');

        const digest = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            'abc',
            { encoding: Crypto.CryptoEncoding.HEX },
        );
        ctx.log(`digest=${digest}`);
        expectEqual(digest, SHA256_OF_ABC, 'native digest');
    },
};

// ─── 主机名 allowlist（纯函数 —— 无 KV / 无网络）──────────────────────────

const hostnameSuffixMatches: TestCase = {
    id: 'hostname-suffix-matches',
    name: 'hostnameMatchesAnyAllowlist approves child of an allowed suffix',
    group: 'verify',
    async run(ctx) {
        const allow = new Set([await sha256Hex(FIXTURE_PARENT)]);
        const matched = await hostnameMatchesAnyAllowlist(FIXTURE_CHILD, allow);
        ctx.log(`host=${FIXTURE_CHILD}, allowlist=[sha256(${FIXTURE_PARENT})]`);
        expectEqual(matched, true, 'match');
    },
};

const hostnameNotInAllowlist: TestCase = {
    id: 'hostname-not-in-allowlist',
    name: 'hostnameMatchesAnyAllowlist rejects hosts outside the suffix',
    group: 'verify',
    async run(ctx) {
        const allow = new Set([await sha256Hex(FIXTURE_PARENT)]);
        const matched = await hostnameMatchesAnyAllowlist(FIXTURE_UNRELATED, allow);
        ctx.log(`host=${FIXTURE_UNRELATED}, matched=${matched}`);
        expectEqual(matched, false, 'match');
    },
};

const hostnameMultipleAllowlists: TestCase = {
    id: 'hostname-multiple-allowlists',
    name: 'hostnameMatchesAnyAllowlist honours union across lists',
    group: 'verify',
    async run(_ctx) {
        const known    = new Set<string>();
        const verified = new Set([await sha256Hex(FIXTURE_PARENT)]);
        const matched = await hostnameMatchesAnyAllowlist(FIXTURE_CHILD, known, verified);
        expectEqual(matched, true, 'match via second list');
    },
};

// ─── Apply（fake VPN）────────────────────────────────────────────────────────

const applyStartResolves: TestCase = {
    id: 'apply-start-resolves',
    name: 'fake VPN start resolves and receives config',
    group: 'apply',
    async run(ctx) {
        ctx.fakeVpn.startBehavior = { kind: 'resolve' };
        const configBlob = JSON.stringify({ test: true, at: Date.now() });
        await ctx.fakeVpn.start(configBlob);
        ctx.log(`start.callCount=${ctx.fakeVpn.callCount.start}`);
        expectEqual(ctx.fakeVpn.callCount.start, 1, 'start call count');
        expectEqual(ctx.fakeVpn.lastConfig, configBlob, 'config passthrough');
    },
};

const applyStartRejectsWithMessage: TestCase = {
    id: 'apply-start-rejects-with-message',
    name: 'fake VPN start rejects propagate concrete error message',
    group: 'apply',
    async run(ctx) {
        ctx.fakeVpn.startBehavior = { kind: 'reject', message: 'simulated-native-failure' };
        const err = await expectThrows(
            () => ctx.fakeVpn.start('{"any":"config"}'),
            'fakeVpn.start should reject',
            'simulated-native-failure',
        );
        ctx.log(`caught=${err.message}`);
    },
};

const applyStartHangCaughtByTimeout: TestCase = {
    id: 'apply-start-hang-caught-by-timeout',
    name: 'hung start() is interrupted by race-with-timeout within 500ms',
    group: 'apply',
    async run(ctx) {
        ctx.fakeVpn.startBehavior = { kind: 'hang' };
        const startedAt = Date.now();
        const err = await expectThrows(
            () => raceWithTimeout(
                ctx.fakeVpn.start('{"any":"config"}'),
                500,
                'timeout reached after 500ms',
            ),
            'race must reject',
            'timeout reached',
        );
        const elapsed = Date.now() - startedAt;
        ctx.log(`elapsed=${elapsed}ms, caught=${err.message}`);
        // 给一个宽松的上限 —— 低端设备上 JS setTimeout 有调度抖动。这里要守护的
        // 回归是"超时确实触发、没有永远挂起"，而非精确计时。
        expect(elapsed < 1500, `race took too long: ${elapsed}ms`);
    },
};

// ─── Import-flow 流水线（状态机级组合）────────────────────────
//
// 上面的构件用例守护各个零件；这四个用例把真实的 `createImportFlowMachine`
// 流水线端到端跑在 Hermes 上，用适配成 context-action 形状的 FakeVpnModule。
// 它们存在的意义是捕获 V8 上的 node:test 看不到的运行时级回归（atob、
// microtask 排序、AbortController）—— 状态转移逻辑本身由
// src/hooks/import-flow-machine.test.ts 覆盖。

const FLOW_URL = 'https://fixture.invalid/raw/pro.json';

function flowDeps(ctx: TestContext, overrides?: Partial<ImportFlowDeps>): {
    deps: ImportFlowDeps;
    upserts: Omit<Profile, 'id' | 'addedAt'>[];
} {
    const actions = fakeVpnAsActions(ctx.fakeVpn);
    const upserts: Omit<Profile, 'id' | 'addedAt'>[] = [];
    const deps: ImportFlowDeps = {
        verifyHostname: () => Promise.resolve(true),
        stop: actions.stop,
        start: actions.start,
        fetchConfig: (): Promise<ConfigFetchResult> => Promise.resolve({
            statusCode: 200,
            headers: {
                'subscription-userinfo': 'upload=10; download=20; total=100; expire=0',
                'content-disposition': 'attachment; filename="pro.json"',
            },
            body: '{"outbounds":[]}',
        }),
        userAgent: 'SmokeUA/1.0',
        profiles: {
            findByUrl: () => null,
            upsertByUrl: (data) => {
                upserts.push(data);
                return { id: 'smoke', addedAt: 0, ...data };
            },
        },
        logFlowEvent: () => {},
        recordFlowFailure: () => {},
        haptics: { notifySuccess: () => {}, notifyError: () => {} },
        log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        ...overrides,
    };
    return { deps, upserts };
}

/** 运行状态机，到达终态阶段后 resolve。 */
function awaitTerminal(machine: ImportFlowMachine, timeoutMs: number): Promise<ImportPhase> {
    const terminal = new Set(['success', 'applied', 'error', 'idle']);
    return raceWithTimeout(
        new Promise<ImportPhase>((resolve) => {
            const check = () => {
                const snapshot = machine.getSnapshot();
                if (terminal.has(snapshot.phase)) resolve(snapshot);
            };
            machine.subscribe(check);
            machine.run();
            // idle 从不通知（run 在任何转移前就返回）——
            // 对这类空操作路径，在一个 tick 后轮询一次。
            setTimeout(check, 50);
        }),
        timeoutMs,
        `machine did not reach a terminal phase within ${timeoutMs}ms`,
    );
}

const importFlowApplyHappyPath: TestCase = {
    id: 'import-flow-apply-happy-path',
    name: 'pipeline: apply=1 verified runs stop → download → start → applied',
    group: 'import',
    async run(ctx) {
        const { deps, upserts } = flowDeps(ctx);
        const machine = createImportFlowMachine(
            { data: btoa(FLOW_URL), apply: '1' },
            deps,
        );
        const final = await awaitTerminal(machine, 3000);
        ctx.log(`final=${final.phase}, stopCalls=${ctx.fakeVpn.callCount.stop}, startCalls=${ctx.fakeVpn.callCount.start}`);
        expectEqual(final.phase, 'applied', 'terminal phase');
        expectEqual(ctx.fakeVpn.callCount.stop, 1, 'stop calls');
        expectEqual(ctx.fakeVpn.callCount.start, 1, 'start calls');
        expectEqual(upserts.length, 1, 'profile upserts');
        expectEqual(upserts[0].name, 'pro.json', 'derived name');
    },
};

const importFlowUnverifiedDowngrade: TestCase = {
    id: 'import-flow-unverified-downgrade',
    name: 'pipeline: apply=1 unverified downgrades to manual success (no stop/start)',
    group: 'import',
    async run(ctx) {
        const { deps, upserts } = flowDeps(ctx, { verifyHostname: () => Promise.resolve(false) });
        const machine = createImportFlowMachine(
            { data: btoa(FLOW_URL), apply: '1' },
            deps,
        );
        const final = await awaitTerminal(machine, 3000);
        ctx.log(`final=${final.phase}, stopCalls=${ctx.fakeVpn.callCount.stop}`);
        expectEqual(final.phase, 'success', 'terminal phase');
        expectEqual(ctx.fakeVpn.callCount.stop, 0, 'stop calls');
        expectEqual(ctx.fakeVpn.callCount.start, 0, 'start calls');
        expectEqual(upserts.length, 1, 'profile upserts');
    },
};

const importFlowStartRejectSurfacesError: TestCase = {
    id: 'import-flow-start-reject-surfaces-error',
    name: 'pipeline: start rejection surfaces as error(start-failed), not a pinned loader',
    group: 'import',
    async run(ctx) {
        ctx.fakeVpn.startBehavior = { kind: 'reject', message: 'simulated-native-failure' };
        const { deps } = flowDeps(ctx);
        const machine = createImportFlowMachine(
            { data: btoa(FLOW_URL), apply: '1' },
            deps,
        );
        const final = await awaitTerminal(machine, 3000);
        ctx.log(`final=${JSON.stringify(final)}`);
        expect(final.phase === 'error', `expected error phase, got ${final.phase}`);
        expect(
            final.phase === 'error' && final.error.kind === 'start-failed',
            'expected start-failed error kind',
        );
        expect(
            final.phase === 'error'
                && final.error.kind === 'start-failed'
                && final.error.failure.kind === 'native-error'
                && final.error.failure.message === 'simulated-native-failure',
            'native-error message must carry through the pipeline',
        );
    },
};

const importFlowStartHangCaughtByTimeout: TestCase = {
    id: 'import-flow-start-hang-caught-by-timeout',
    name: 'pipeline: hung start is caught by the machine start timeout',
    group: 'import',
    async run(ctx) {
        ctx.fakeVpn.startBehavior = { kind: 'hang' };
        const { deps } = flowDeps(ctx);
        const machine = createImportFlowMachine(
            { data: btoa(FLOW_URL), apply: '1' },
            deps,
            { startTimeoutMs: 500 },
        );
        const startedAt = Date.now();
        const final = await awaitTerminal(machine, 3000);
        const elapsed = Date.now() - startedAt;
        ctx.log(`final=${JSON.stringify(final)}, elapsed=${elapsed}ms`);
        expect(
            final.phase === 'error'
                && final.error.kind === 'start-failed'
                && final.error.failure.kind === 'timeout',
            'expected start-failed timeout',
        );
        // 宽松的上限 —— 低端设备上的调度抖动；这里守护的回归是"永远挂起"，
        // 而非精确计时。
        expect(elapsed < 1500, `timeout took too long: ${elapsed}ms`);
    },
};

// ─── 导出的套件 ──────────────────────────────────────────────────────────

export const IMPORT_TEST_CASES: readonly TestCase[] = [
    parseSchemeWithApply,
    parseSchemeWithoutApply,
    parsePlainHttps,
    parseGarbage,
    parseSpecialBase64,
    cryptoSha256KnownDigest,
    cryptoSha256Deterministic,
    cryptoExpoModuleLinked,
    hostnameSuffixMatches,
    hostnameNotInAllowlist,
    hostnameMultipleAllowlists,
    applyStartResolves,
    applyStartRejectsWithMessage,
    applyStartHangCaughtByTimeout,
    importFlowApplyHappyPath,
    importFlowUnverifiedDowngrade,
    importFlowStartRejectSurfacesError,
    importFlowStartHangCaughtByTimeout,
];
