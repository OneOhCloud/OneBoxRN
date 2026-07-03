import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flushMicrotasks } from '../contexts/vpn/test-doubles.ts';
import type { StartResult, StopResult } from '../contexts/vpn/types.ts';
import type { Profile } from '../database/profile-store-core.ts';
import type { ConfigFetchResult } from '../modules/expo-onebox/src/ExpoOneBox.types.ts';
import type { FlowEvent } from '../utils/flow-events.ts';
import { djb2Hash } from '../utils/log-redact.ts';
import {
    createImportFlowMachine,
    type ImportFlowDeps,
    type ImportFlowInput,
    type ImportPhase,
} from './import-flow-machine.ts';

const URL_OK = 'https://config.example.invalid/raw/pro.json';
const DATA_OK = Buffer.from(URL_OK, 'utf8').toString('base64');

function okResponse(overrides?: Partial<ConfigFetchResult>): ConfigFetchResult {
    return {
        statusCode: 200,
        headers: {
            'subscription-userinfo': 'upload=100; download=300; total=1000; expire=1735689600',
            'content-disposition': 'attachment; filename="pro.json"',
        },
        body: '{"outbounds":[]}',
        ...overrides,
    };
}

type UpsertPayload = Omit<Profile, 'id' | 'addedAt'>;

interface Harness {
    deps: ImportFlowDeps;
    calls: string[];
    events: FlowEvent[];
    failures: FlowEvent[];
    upserts: UpsertPayload[];
    haptics: string[];
    phases: string[];
    errorLogs: string[];
}

function makeHarness(overrides?: Partial<ImportFlowDeps>): Harness {
    const calls: string[] = [];
    const events: FlowEvent[] = [];
    const failures: FlowEvent[] = [];
    const upserts: UpsertPayload[] = [];
    const haptics: string[] = [];
    const phases: string[] = [];
    const errorLogs: string[] = [];
    const deps: ImportFlowDeps = {
        verifyHostname: (hostname) => {
            calls.push(`verify:${hostname}`);
            return Promise.resolve(true);
        },
        stop: () => {
            calls.push('stop');
            return Promise.resolve({ outcome: 'stopped' } as StopResult);
        },
        start: () => {
            calls.push('start');
            return Promise.resolve({ ok: true } as StartResult);
        },
        fetchConfig: (url) => {
            calls.push(`fetch:${url}`);
            return Promise.resolve(okResponse());
        },
        userAgent: 'TestUA/1.0',
        profiles: {
            findByUrl: () => null,
            upsertByUrl: (data) => {
                upserts.push(data);
                return { id: 'p1', addedAt: 0, ...data };
            },
        },
        logFlowEvent: (e) => events.push(e),
        recordFlowFailure: (e) => failures.push(e),
        haptics: {
            notifySuccess: () => haptics.push('success'),
            notifyError: () => haptics.push('error'),
        },
        log: { debug: () => {}, info: () => {}, warn: () => {}, error: (msg) => errorLogs.push(msg) },
        now: () => 1_000,
        ...overrides,
    };
    return { deps, calls, events, failures, upserts, haptics, phases, errorLogs };
}

/** Run the machine to quiescence, recording every phase transition. */
async function runToEnd(
    input: ImportFlowInput,
    h: Harness,
    options?: Parameters<typeof createImportFlowMachine>[2],
): Promise<{ machine: ReturnType<typeof createImportFlowMachine>; final: ImportPhase }> {
    const machine = createImportFlowMachine(input, h.deps, options);
    machine.subscribe(() => h.phases.push(machine.getSnapshot().phase));
    machine.run();
    // The pipeline is a chain of already-resolved promises; a few microtask
    // turns settle it.
    await flushMicrotasks();
    return { machine, final: machine.getSnapshot() };
}

describe('createImportFlowMachine', () => {
    it('manual import (no apply): downloads, stores, ends in success; stop/start never called', async () => {
        const h = makeHarness();
        // Manual imports start idle (parity: the old screen's first frame
        // was DefaultView until the pre-download effect fired).
        const probe = createImportFlowMachine({ data: DATA_OK, apply: undefined }, h.deps);
        assert.equal(probe.getSnapshot().phase, 'idle');

        const { final } = await runToEnd({ data: DATA_OK, apply: undefined }, h);

        assert.deepEqual(h.phases, ['downloading', 'success']);
        assert.deepEqual(final, {
            phase: 'success',
            extraInfo: { upload: 100, download: 300, total: 1000, expire: 1735689600 },
        });
        assert.ok(!h.calls.includes('stop'));
        assert.ok(!h.calls.includes('start'));
        assert.ok(!h.calls.some((c) => c.startsWith('verify:')));
        assert.deepEqual(h.upserts, [{
            name: 'pro.json',
            url: URL_OK,
            usedTraffic: 400,
            totalTraffic: 1000,
            expireTime: 1735689600,
            configContent: '{"outbounds":[]}',
        }]);
        assert.deepEqual(h.haptics, ['success']);
        assert.deepEqual(h.events.map((e) => `${e.phase}:${e.status}`), [
            'capture:start', 'download:start', 'download:ok', 'store:ok',
        ]);
        assert.equal(h.events.find((e) => e.phase === 'store')?.profileIdHash, djb2Hash(URL_OK));
    });

    it('apply=1 + verified: full chain with one flowId across every event', async () => {
        const h = makeHarness();
        // First-frame contract: an apply=1 deep link must present as busy
        // (LoadingView) from the very first snapshot, before run() fires.
        const probe = createImportFlowMachine({ data: DATA_OK, apply: '1' }, h.deps);
        assert.equal(probe.getSnapshot().phase, 'verifying');

        const { machine, final } = await runToEnd({ data: DATA_OK, apply: '1' }, h);

        assert.deepEqual(h.phases, ['stopping', 'downloading', 'applying', 'applied']);
        assert.equal(final.phase, 'applied');
        assert.deepEqual(h.calls, [
            'verify:config.example.invalid', 'stop', `fetch:${URL_OK}`, 'start',
        ]);
        assert.deepEqual(h.events.map((e) => `${e.phase}:${e.status}`), [
            'capture:start', 'verify:ok', 'stop:ok', 'download:start',
            'download:ok', 'store:ok', 'start:start', 'start:ok', 'apply:ok',
        ]);
        assert.ok(h.events.every((e) => e.flowId === machine.flowId));
        assert.ok(h.events.every((e) => e.event === 'config_import'));
        // Download success still fires the success haptic on the apply path.
        assert.deepEqual(h.haptics, ['success']);
    });

    it('apply=1 + unverified host: downgrades to manual — no stop, ends in success', async () => {
        const h = makeHarness({ verifyHostname: () => Promise.resolve(false) });
        const { final } = await runToEnd({ data: DATA_OK, apply: '1' }, h);

        assert.deepEqual(h.phases, ['downloading', 'success']);
        assert.equal(final.phase, 'success');
        assert.ok(!h.calls.includes('stop'));
        assert.ok(!h.calls.includes('start'));
        assert.equal(h.events.find((e) => e.phase === 'verify')?.detail, 'verified=false');
    });

    it('verify rejection: error(verify-failed) + recordFlowFailure — the pinned-LoadingView regression', async () => {
        const h = makeHarness({ verifyHostname: () => Promise.reject(new Error('crypto.subtle missing')) });
        const { final } = await runToEnd({ data: DATA_OK, apply: '1' }, h);

        assert.deepEqual(final, {
            phase: 'error',
            error: { kind: 'verify-failed', message: 'crypto.subtle missing' },
        });
        assert.equal(h.failures.length, 1);
        assert.equal(h.failures[0].phase, 'verify');
        assert.equal(h.failures[0].status, 'fail');
        assert.ok(!h.calls.some((c) => c.startsWith('fetch:')));
    });

    it('every stop outcome proceeds to the download', async () => {
        const outcomes: StopResult[] = [
            { outcome: 'stopped' },
            { outcome: 'already-stopped' },
            { outcome: 'timeout' },
            { outcome: 'stop-rejected', message: 'boom' },
        ];
        for (const stopResult of outcomes) {
            const h = makeHarness({ stop: () => Promise.resolve(stopResult) });
            const { final } = await runToEnd({ data: DATA_OK, apply: '1' }, h);
            assert.equal(final.phase, 'applied', `outcome=${stopResult.outcome}`);
            assert.equal(
                h.events.find((e) => e.phase === 'stop')?.detail,
                `outcome=${stopResult.outcome}`,
            );
        }
    });

    it('HTTP failure: error(download-http) with HTTP_<status> errorCode and error haptic', async () => {
        const h = makeHarness({ fetchConfig: () => Promise.resolve(okResponse({ statusCode: 500, body: 'nope' })) });
        const { final } = await runToEnd({ data: DATA_OK, apply: undefined }, h);

        assert.deepEqual(final, { phase: 'error', error: { kind: 'download-http', statusCode: 500 } });
        assert.equal(h.failures[0].errorCode, 'HTTP_500');
        assert.deepEqual(h.haptics, ['error']);
        assert.equal(h.upserts.length, 0);
    });

    it('2xx with undecodable body: error(invalid-content), nothing stored, start never reached', async () => {
        // The stripped-Content-Encoding proxy defect: 200 + gzip bytes as text.
        const h = makeHarness({ fetchConfig: () => Promise.resolve(okResponse({ body: '�' })) });
        const { final } = await runToEnd({ data: DATA_OK, apply: '1' }, h);

        assert.deepEqual(final, { phase: 'error', error: { kind: 'invalid-content', reason: 'not-json' } });
        assert.equal(h.upserts.length, 0);
        assert.ok(!h.calls.includes('start'));
        assert.equal(h.failures[0].phase, 'download');
        assert.equal(h.failures[0].errorCode, 'INVALID_CONTENT');
        assert.deepEqual(h.haptics, ['error']);
    });

    it('2xx with a non-object JSON body fails validation on the manual path too', async () => {
        const h = makeHarness({ fetchConfig: () => Promise.resolve(okResponse({ body: '[]' })) });
        const { final } = await runToEnd({ data: DATA_OK, apply: undefined }, h);

        assert.deepEqual(final, { phase: 'error', error: { kind: 'invalid-content', reason: 'not-object' } });
        assert.equal(h.upserts.length, 0);
    });

    it('network failure: error(download-network) with the classified errorCode', async () => {
        const h = makeHarness({ fetchConfig: () => Promise.reject(new Error('request timed out')) });
        const { final } = await runToEnd({ data: DATA_OK, apply: undefined }, h);

        assert.deepEqual(final, { phase: 'error', error: { kind: 'download-network', message: 'request timed out' } });
        assert.equal(h.failures[0].errorCode, 'TIMEOUT');
        assert.deepEqual(h.haptics, ['error']);
    });

    it('start failures map to error(start-failed) with kind-derived errorCodes; aborted stays silent', async () => {
        const cases: [StartResult, string | null][] = [
            [{ ok: false, failure: { kind: 'permission-denied' } }, 'PERMISSION_DENIED'],
            [{ ok: false, failure: { kind: 'timeout', timeoutMs: 20_000 } }, 'TIMEOUT'],
            [{ ok: false, failure: { kind: 'config-error', message: 'No config content found' } }, 'UNKNOWN'],
            [{ ok: false, failure: { kind: 'native-error', message: 'ssl handshake failed' } }, 'TLS'],
            [{ ok: false, failure: { kind: 'aborted' } }, null],
        ];
        for (const [startResult, expectedCode] of cases) {
            const h = makeHarness({ start: () => Promise.resolve(startResult) });
            const { final } = await runToEnd({ data: DATA_OK, apply: '1' }, h);
            if (expectedCode === null) {
                // aborted: no error phase, no navigation — screen is unmounting.
                assert.equal(final.phase, 'applying');
                assert.equal(h.failures.length, 0);
            } else {
                assert.equal(final.phase, 'error');
                const failure = h.failures.find((e) => e.phase === 'start');
                assert.equal(failure?.errorCode, expectedCode);
                assert.ok(final.phase === 'error' && final.error.kind === 'start-failed');
            }
        }
    });

    it('start failure keeps the raw native message in the error-level log', async () => {
        const h = makeHarness({
            start: () => Promise.resolve({
                ok: false,
                failure: { kind: 'native-error', message: 'tunnel file descriptor stolen' },
            }),
        });
        await runToEnd({ data: DATA_OK, apply: '1' }, h);
        assert.ok(
            h.errorLogs.some((line) => line.includes('tunnel file descriptor stolen')),
            `error log must carry the native message; got: ${JSON.stringify(h.errorLogs)}`,
        );
    });

    it('cancel mid-download drops the result: no further phases, start never invoked', async () => {
        let release: (r: ConfigFetchResult) => void = () => {};
        const gate = new Promise<ConfigFetchResult>((resolve) => { release = resolve; });
        const h = makeHarness({ fetchConfig: () => gate });
        const machine = createImportFlowMachine({ data: DATA_OK, apply: '1' }, h.deps);
        machine.subscribe(() => h.phases.push(machine.getSnapshot().phase));
        machine.run();
        await flushMicrotasks();
        assert.equal(machine.getSnapshot().phase, 'downloading');

        machine.cancel();
        release(okResponse());
        await flushMicrotasks();

        assert.equal(machine.getSnapshot().phase, 'downloading');
        assert.ok(!h.calls.includes('start'));
        assert.equal(h.upserts.length, 0);
    });

    it('run() is latched: second run() does not restart the pipeline', async () => {
        const h = makeHarness();
        const machine = createImportFlowMachine({ data: DATA_OK, apply: undefined }, h.deps);
        machine.run();
        machine.run();
        await flushMicrotasks();
        assert.equal(h.calls.filter((c) => c.startsWith('fetch:')).length, 1);
        assert.equal(h.upserts.length, 1);
    });

    it('bad payloads end idle with a capture fail event; missing data stays idle with capture start', async () => {
        const badBase64 = makeHarness({ decodeBase64: () => { throw new Error('bad b64'); } });
        const r1 = await runToEnd({ data: '!!!', apply: undefined }, badBase64);
        assert.equal(r1.final.phase, 'idle');
        assert.equal(badBase64.events[0].phase, 'capture');
        assert.equal(badBase64.events[0].status, 'fail');
        assert.equal(badBase64.events[0].detail, 'apply=false hasUrl=false');

        const notHttps = makeHarness();
        const r2 = await runToEnd(
            { data: Buffer.from('http://insecure.invalid', 'utf8').toString('base64'), apply: undefined },
            notHttps,
        );
        assert.equal(r2.final.phase, 'idle');
        assert.equal(notHttps.events[0].status, 'fail');

        const noData = makeHarness();
        const r3 = await runToEnd({ data: undefined, apply: undefined }, noData);
        assert.equal(r3.final.phase, 'idle');
        assert.deepEqual(noData.events.map((e) => `${e.phase}:${e.status}`), ['capture:start']);
        assert.equal(noData.events[0].detail, 'apply=false hasUrl=false');
    });

    it('name fallback chain: content-disposition → existing profile name → url filename → hostname', async () => {
        // No content-disposition, existing profile by URL → its name wins.
        const existing = makeHarness({
            fetchConfig: () => Promise.resolve(okResponse({ headers: { 'subscription-userinfo': 'upload=1; download=2; total=3; expire=4' } })),
        });
        existing.deps.profiles = {
            findByUrl: () => ({
                id: 'p0', addedAt: 0, name: 'Existing', url: URL_OK,
                usedTraffic: 0, totalTraffic: 0, expireTime: 0, configContent: '',
            }),
            upsertByUrl: (data) => {
                existing.upserts.push(data);
                return { id: 'p0', addedAt: 0, ...data };
            },
        };
        await runToEnd({ data: DATA_OK, apply: undefined }, existing);
        assert.equal(existing.upserts[0].name, 'Existing');

        // No header, no existing → URL filename.
        const filename = makeHarness({
            fetchConfig: () => Promise.resolve(okResponse({ headers: {} })),
        });
        await runToEnd({ data: DATA_OK, apply: undefined }, filename);
        assert.equal(filename.upserts[0].name, 'pro.json');

        // No filename segment either → hostname.
        const hostOnly = makeHarness({
            fetchConfig: () => Promise.resolve(okResponse({ headers: {} })),
        });
        const bareUrl = 'https://bare.example.invalid/';
        await runToEnd(
            { data: Buffer.from(bareUrl, 'utf8').toString('base64'), apply: undefined },
            hostOnly,
        );
        assert.equal(hostOnly.upserts[0].name, 'bare.example.invalid');
    });

    it('missing userinfo header parses to zeros and still succeeds', async () => {
        const h = makeHarness({
            fetchConfig: () => Promise.resolve(okResponse({ headers: {} })),
        });
        const { final } = await runToEnd({ data: DATA_OK, apply: undefined }, h);
        assert.deepEqual(final, {
            phase: 'success',
            extraInfo: { upload: 0, download: 0, total: 0, expire: 0 },
        });
    });
});
