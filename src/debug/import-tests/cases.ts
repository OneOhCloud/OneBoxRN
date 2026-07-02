/**
 * Entry-level test cases for the import flow.
 *
 * Each case targets one externally-observable behaviour of the import
 * entry chain (QR parse → hash → allowlist match → VPN apply). Cases
 * deliberately avoid the ConfigScreen render loop and instead invoke
 * the underlying building blocks so a regression produces a point
 * failure rather than a generic "import is broken".
 *
 * Mapping to production bugs this suite guards against:
 *   - `crypto-expo-module-linked` + `crypto-sha256-known-digest` +
 *     `crypto-sha256-deterministic` — today's root cause
 *     ("Property 'crypto' doesn't exist") plus the fix via `expo-crypto`.
 *   - `apply-start-rejects-with-message` + `apply-start-hang-caught-by-timeout`
 *     — the behaviour the ConfigScreen depends on for surfacing errors
 *     instead of pinning `LoadingView`.
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

// SHA-256 of the ASCII string "abc" — used as the canary known-vector.
// If this ever changes, the crypto implementation has a real bug.
const SHA256_OF_ABC =
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

// Fixture hostnames for allowlist tests. Must never collide with the
// real compile-time allowlist entries — using clearly-fictional TLDs.
const FIXTURE_PARENT   = 'fixture.invalid';
const FIXTURE_CHILD    = 'child.fixture.invalid';
const FIXTURE_UNRELATED = 'other.invalid';

// ─── Parse / recognition ─────────────────────────────────────────────────────

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
        // `atob` round-trip proves we can decode downstream.
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
        // Mirrors the real-world failing QR: the payload contains a
        // base64-internal "/" and trailing "==" padding.
        const innerUrl = 'https://config.example.invalid/sub/ea759de3-fb03-4371?protocol=tuic';
        const base64 = btoa(innerUrl);
        expect(base64.includes('/'), 'fixture sanity: base64 must contain "/"');
        expect(base64.endsWith('=='), 'fixture sanity: base64 must end with "=="');

        // Step 1: scanner parses the scheme URL.
        const scanned = resolveQRData(`oneoh-networktools://config?data=${base64}&apply=1`);
        expect(scanned !== null, 'scanner parse failed');
        expectEqual(scanned!.data, base64, 'scanner data');
        expectEqual(scanned!.apply, '1', 'scanner apply');

        // Step 2: URL-encode (what `router.push` does).
        const encoded = encodeURIComponent(scanned!.data);
        // Step 3: decode via URL API (what Expo Router does on the other side).
        const u = new URL(`http://dummy/config?data=${encoded}&apply=1`);
        const backAtConfig = u.searchParams.get('data');
        expectEqual(backAtConfig, base64, 'router round-trip');

        // Step 4: atob.
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
        // Direct-to-native path. If this fails, `sha256Hex`'s fallback
        // branch would fail too on RN (where `crypto.subtle` is absent).
        // The intent is to surface link / prebuild breakage with a
        // clear message instead of letting it masquerade as a generic
        // "verify stuck" symptom in the real flow.
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

// ─── Hostname allowlist (pure — no KV / no network) ──────────────────────────

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

// ─── Apply (fake VPN) ────────────────────────────────────────────────────────

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
        // Give a generous ceiling — JS setTimeout has scheduling jitter
        // on low-end devices. 1500ms means "the timeout did fire and
        // we did not hang forever", which is the actual regression we
        // are guarding.
        expect(elapsed < 1500, `race took too long: ${elapsed}ms`);
    },
};

// ─── Import-flow pipeline (machine-level composition) ────────────────────────
//
// The building-block cases above guard the pieces; these four drive the real
// `createImportFlowMachine` pipeline end-to-end on Hermes with FakeVpnModule
// adapted to the context-action shape. They exist to catch runtime-class
// regressions (atob, microtask ordering, AbortController) that node:test on
// V8 cannot see — the transition logic itself is covered by
// src/hooks/import-flow-machine.test.ts.

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

/** Run the machine and resolve once it reaches a terminal phase. */
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
            // idle never notifies (run returns before any transition) —
            // poll once after a tick for the no-op paths.
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
        // Generous ceiling — scheduling jitter on low-end devices; the
        // regression guarded here is "hangs forever", not exact timing.
        expect(elapsed < 1500, `timeout took too long: ${elapsed}ms`);
    },
};

// ─── Exported suite ──────────────────────────────────────────────────────────

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
