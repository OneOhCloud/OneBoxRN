import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskRecord } from '../database/kv.ts';
import type { ConfigRefreshResult } from '../modules/expo-onebox/src/ExpoOneBox.types.ts';
import { formatFlowEvent, type FlowEvent } from '../utils/flow-events.ts';
import { djb2Hash, redactUrl } from '../utils/log-redact.ts';
import {
    applyRefreshResult,
    type RefreshApplyDeps,
} from './config-refresh-core.ts';

const URL = 'https://config.example.invalid/path/profile';

function makeResult(overrides?: Partial<ConfigRefreshResult>): ConfigRefreshResult {
    return {
        status: 'success',
        content: '{"outbounds":[]}',
        subscriptionUpload: 100,
        subscriptionDownload: 300,
        subscriptionTotal: 1000,
        subscriptionExpire: 1_735_689_600,
        timestamp: '2026-07-02T08:00:00.000Z',
        durationMs: 420,
        method: 'primary',
        ...overrides,
    };
}

interface Recorded {
    deps: RefreshApplyDeps;
    setterCalls: [string, unknown][];
    appended: { url: string; record: TaskRecord }[];
    flowEvents: FlowEvent[];
    failures: FlowEvent[];
}

function makeDeps(storedContent = ''): Recorded {
    const setterCalls: [string, unknown][] = [];
    const appended: { url: string; record: TaskRecord }[] = [];
    const flowEvents: FlowEvent[] = [];
    const failures: FlowEvent[] = [];
    const deps: RefreshApplyDeps = {
        sbConfig: {
            getConfigContent: () => storedContent,
            setConfigContent: (v) => setterCalls.push(['setConfigContent', v]),
            setUsedTraffic: (v) => setterCalls.push(['setUsedTraffic', v]),
            setTotalTraffic: (v) => setterCalls.push(['setTotalTraffic', v]),
            setExpireTime: (v) => setterCalls.push(['setExpireTime', v]),
        },
        taskLog: { append: (url, record) => appended.push({ url, record }) },
        logFlowEvent: (e) => flowEvents.push(e),
        recordFlowFailure: (e) => failures.push(e),
    };
    return { deps, setterCalls, appended, flowEvents, failures };
}

describe('applyRefreshResult', () => {
    it('success with changed content: exact setter values + golden TaskRecord bytes', () => {
        const { deps, setterCalls, appended, flowEvents, failures } = makeDeps('OLD');
        applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'manual-direct',
            flowId: 'flow0001',
        });

        assert.deepEqual(setterCalls, [
            ['setUsedTraffic', 400],
            ['setTotalTraffic', 1000],
            ['setExpireTime', 1_735_689_600],
            ['setConfigContent', '{"outbounds":[]}'],
        ]);

        assert.equal(appended.length, 1);
        assert.equal(appended[0].url, URL);
        // Golden KV bytes: key order and undefined-dropping are load-bearing —
        // TaskLog persists JSON.stringify(record) into SQLite KV.
        assert.equal(
            JSON.stringify(appended[0].record),
            '{"time":"2026-07-02T08:00:00.000Z","status":"success","trigger":"manual-direct",'
            + '"duration":420,"method":"primary","contentChanged":true,"flowId":"flow0001",'
            + '"upload":100,"download":300,"total":1000,"expire":1735689600}',
        );

        assert.equal(failures.length, 0);
        assert.deepEqual(flowEvents, [{
            event: 'config_refresh',
            flowId: 'flow0001',
            phase: 'refresh',
            status: 'ok',
            method: 'primary',
            durationMs: 420,
            errorCode: undefined,
            profileIdHash: djb2Hash(URL),
            detail: 'trigger=manual-direct contentChanged=true',
        }]);
    });

    it('success with identical content: no content write, contentChanged=false', () => {
        const { deps, setterCalls, appended } = makeDeps('{"outbounds":[]}');
        applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0002',
        });

        assert.ok(!setterCalls.some(([name]) => name === 'setConfigContent'));
        assert.equal(appended[0].record.contentChanged, false);
        assert.equal(appended[0].record.trigger, 'auto');
    });

    it('success with undecodable content: demoted to failed, zero setters, INVALID_CONTENT code', () => {
        // The stripped-Content-Encoding proxy defect: 200 + gzip bytes as text.
        const { deps, setterCalls, appended, flowEvents, failures } = makeDeps('OLD');
        applyRefreshResult(deps, {
            result: makeResult({ content: '�' }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0009',
        });

        assert.deepEqual(setterCalls, []);
        assert.equal(appended.length, 1);
        assert.equal(appended[0].record.status, 'failed');
        assert.equal(appended[0].record.contentChanged, false);
        assert.equal(appended[0].record.error, 'invalid config content (not-json)');
        assert.equal(flowEvents.length, 0);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].status, 'fail');
        assert.equal(failures[0].errorCode, 'INVALID_CONTENT');
    });

    it('success with no content: gate does not fire — traffic still applied', () => {
        const { deps, setterCalls, appended, failures } = makeDeps();
        applyRefreshResult(deps, {
            result: makeResult({ content: undefined }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0010',
        });

        assert.deepEqual(setterCalls.map(([name]) => name), [
            'setUsedTraffic', 'setTotalTraffic', 'setExpireTime',
        ]);
        assert.equal(appended[0].record.status, 'success');
        assert.equal(failures.length, 0);
    });

    it('failed: zero setters, TaskRecord still appended with the failed traffic fields, routed to recordFlowFailure', () => {
        const { deps, setterCalls, appended, flowEvents, failures } = makeDeps();
        applyRefreshResult(deps, {
            result: makeResult({
                status: 'failed',
                content: undefined,
                error: 'HTTP 404',
                method: 'fallback',
                subscriptionUpload: 0,
                subscriptionDownload: 0,
                subscriptionTotal: 0,
                subscriptionExpire: 0,
            }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0003',
        });

        assert.deepEqual(setterCalls, []);
        // Current behavior locked: the record carries the failed result's
        // traffic fields (zeros here) rather than being dropped.
        assert.equal(appended.length, 1);
        assert.equal(appended[0].record.status, 'failed');
        assert.equal(appended[0].record.error, 'HTTP 404');
        assert.equal(appended[0].record.method, 'fallback');
        assert.deepEqual(
            [appended[0].record.upload, appended[0].record.download, appended[0].record.total, appended[0].record.expire],
            [0, 0, 0, 0],
        );

        assert.equal(flowEvents.length, 0);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].status, 'fail');
        assert.equal(failures[0].errorCode, 'HTTP_404');
        assert.equal(failures[0].method, 'fallback');
    });

    it('skipped: routed to logFlowEvent with status skip', () => {
        const { deps, flowEvents, failures } = makeDeps();
        applyRefreshResult(deps, {
            result: makeResult({ status: 'skipped', content: undefined }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0004',
        });
        assert.equal(failures.length, 0);
        assert.equal(flowEvents[0].status, 'skip');
    });

    it('actualUrl present → acceleratedUrlRedacted via redactUrl; absent → undefined', () => {
        const accelerated = 'https://accel.example.invalid/u/abc?k=v';
        const withUrl = makeDeps();
        applyRefreshResult(withUrl.deps, {
            result: makeResult({ actualUrl: accelerated }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0005',
        });
        assert.equal(withUrl.appended[0].record.acceleratedUrlRedacted, redactUrl(accelerated));

        const withoutUrl = makeDeps();
        applyRefreshResult(withoutUrl.deps, {
            result: makeResult(),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0006',
        });
        assert.equal(withoutUrl.appended[0].record.acceleratedUrlRedacted, undefined);
    });

    it('method defaults to primary in both the record and the event', () => {
        const { deps, appended, flowEvents } = makeDeps();
        applyRefreshResult(deps, {
            result: makeResult({ method: undefined }),
            url: URL,
            trigger: 'manual-direct',
            flowId: 'flow0007',
        });
        assert.equal(appended[0].record.method, 'primary');
        assert.equal(flowEvents[0].method, 'primary');
    });

    it('golden [EVT] line: formatFlowEvent field order pinned end-to-end', () => {
        const { deps, flowEvents } = makeDeps('OLD');
        applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'manual-direct',
            flowId: 'flow0008',
        });
        assert.equal(
            formatFlowEvent(flowEvents[0]),
            `[EVT] event=config_refresh flow=flow0008 phase=refresh status=ok method=primary `
            + `durationMs=420 profileIdHash=${djb2Hash(URL)} detail=trigger=manual-direct contentChanged=true`,
        );
    });
});
