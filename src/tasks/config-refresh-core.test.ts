import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskRecord } from '../database/kv.ts';
import type { Profile } from '../database/profile-store-core.ts';
import type { ConfigRefreshResult } from '../modules/expo-onebox/src/ExpoOneBox.types.ts';
import { formatFlowEvent, type FlowEvent } from '../utils/flow-events.ts';
import { djb2Hash, redactUrl } from '../utils/log-redact.ts';
import {
    applyRefreshResult,
    resolveResultOriginUrl,
    type RefreshApplyDeps,
} from './config-refresh-core.ts';

const URL = 'https://config.example.invalid/path/profile';
const URL_B = 'https://config-b.example.invalid/other/profile';

function makeResult(overrides?: Partial<ConfigRefreshResult>): ConfigRefreshResult {
    return {
        status: 'success',
        content: '{"outbounds":[]}',
        profileUpload: 100,
        profileDownload: 300,
        profileTotal: 1000,
        profileExpire: 1_735_689_600,
        timestamp: '2026-07-02T08:00:00.000Z',
        durationMs: 420,
        method: 'primary',
        ...overrides,
    };
}

function makeProfile(overrides?: Partial<Profile>): Profile {
    return {
        id: 'prof_a',
        name: 'profile-a',
        url: URL,
        usedTraffic: 0,
        totalTraffic: 1,
        expireTime: 0,
        configContent: 'OLD',
        addedAt: 1_750_000_000_000,
        ...overrides,
    };
}

interface Recorded {
    deps: RefreshApplyDeps;
    updates: { id: string; patch: Partial<Omit<Profile, 'id' | 'addedAt'>> }[];
    appended: { url: string; record: TaskRecord }[];
    flowEvents: FlowEvent[];
    failures: FlowEvent[];
}

function makeDeps(profiles: Profile[]): Recorded {
    const updates: Recorded['updates'] = [];
    const appended: { url: string; record: TaskRecord }[] = [];
    const flowEvents: FlowEvent[] = [];
    const failures: FlowEvent[] = [];
    const deps: RefreshApplyDeps = {
        profiles: {
            findByUrl: (url) => profiles.find(p => p.url === url) ?? null,
            update: (id, patch) => updates.push({ id, patch }),
        },
        taskLog: { append: (url, record) => appended.push({ url, record }) },
        logFlowEvent: (e) => flowEvents.push(e),
        recordFlowFailure: (e) => failures.push(e),
    };
    return { deps, updates, appended, flowEvents, failures };
}

describe('applyRefreshResult', () => {
    it('regression: result for url A only writes profile A — even with a second profile whose content equals the result', () => {
        // B 的 configContent 恰好等于结果内容：若实现误拿其他 profile（如"当前活动
        // 配置"）做比较或写入，contentChanged 会被误判为 false 或 update 目标错误。
        const a = makeProfile();
        const b = makeProfile({
            id: 'prof_b',
            name: 'profile-b',
            url: URL_B,
            configContent: '{"outbounds":[]}',
        });
        const { deps, updates, appended, flowEvents, failures } = makeDeps([a, b]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0011',
        });

        assert.deepEqual(outcome, {
            status: 'applied',
            targetProfileId: 'prof_a',
            contentChanged: true,
        });
        assert.equal(updates.length, 1);
        assert.equal(updates[0].id, 'prof_a');
        assert.deepEqual(updates[0].patch, {
            usedTraffic: 400,
            totalTraffic: 1000,
            expireTime: 1_735_689_600,
            configContent: '{"outbounds":[]}',
        });
        assert.equal(appended.length, 1);
        assert.equal(appended[0].url, URL);
        assert.equal(failures.length, 0);
        assert.equal(flowEvents[0].profileIdHash, djb2Hash(URL));
    });

    it('no matching profile: dropped — zero updates, zero TaskLog, single skip event', () => {
        const { deps, updates, appended, flowEvents, failures } = makeDeps([]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0012',
        });

        assert.deepEqual(outcome, { status: 'dropped' });
        assert.equal(updates.length, 0);
        assert.equal(appended.length, 0);
        assert.equal(failures.length, 0);
        assert.deepEqual(flowEvents, [{
            event: 'config_refresh',
            flowId: 'flow0012',
            phase: 'refresh',
            status: 'skip',
            method: 'primary',
            durationMs: 420,
            profileIdHash: djb2Hash(URL),
            detail: 'trigger=auto dropped=no-matching-profile',
        }]);
    });

    it('success with changed content: single batched update + golden TaskRecord bytes', () => {
        const { deps, updates, appended, flowEvents, failures } = makeDeps([makeProfile()]);
        applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'manual-direct',
            flowId: 'flow0001',
        });

        assert.deepEqual(updates, [{
            id: 'prof_a',
            patch: {
                usedTraffic: 400,
                totalTraffic: 1000,
                expireTime: 1_735_689_600,
                configContent: '{"outbounds":[]}',
            },
        }]);

        assert.equal(appended.length, 1);
        assert.equal(appended[0].url, URL);
        // Golden KV 字节：key 顺序与丢弃 undefined 都是关键 ——
        // TaskLog 会把 JSON.stringify(record) 持久化进 SQLite KV。
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

    it('success with identical content: patch without configContent, contentChanged=false', () => {
        const { deps, updates, appended } = makeDeps([
            makeProfile({ configContent: '{"outbounds":[]}' }),
        ]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult(),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0002',
        });

        assert.deepEqual(outcome, {
            status: 'applied',
            targetProfileId: 'prof_a',
            contentChanged: false,
        });
        assert.deepEqual(updates[0].patch, {
            usedTraffic: 400,
            totalTraffic: 1000,
            expireTime: 1_735_689_600,
        });
        assert.equal(appended[0].record.contentChanged, false);
        assert.equal(appended[0].record.trigger, 'auto');
    });

    it('success with undecodable content: demoted to failed, zero updates, INVALID_CONTENT code', () => {
        // 被剥掉 Content-Encoding 的代理缺陷：200 + gzip 字节被当作文本。
        const { deps, updates, appended, flowEvents, failures } = makeDeps([makeProfile()]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult({ content: '�' }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0009',
        });

        assert.deepEqual(outcome, { status: 'recorded', targetProfileId: 'prof_a' });
        assert.deepEqual(updates, []);
        assert.equal(appended.length, 1);
        assert.equal(appended[0].record.status, 'failed');
        assert.equal(appended[0].record.contentChanged, false);
        assert.equal(appended[0].record.error, 'invalid config content (not-json)');
        assert.equal(flowEvents.length, 0);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].status, 'fail');
        assert.equal(failures[0].errorCode, 'INVALID_CONTENT');
    });

    it('success with no content: gate does not fire — traffic triple still applied', () => {
        const { deps, updates, appended, failures } = makeDeps([makeProfile()]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult({ content: undefined }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0010',
        });

        assert.deepEqual(outcome, {
            status: 'applied',
            targetProfileId: 'prof_a',
            contentChanged: false,
        });
        assert.deepEqual(updates[0].patch, {
            usedTraffic: 400,
            totalTraffic: 1000,
            expireTime: 1_735_689_600,
        });
        assert.equal(appended[0].record.status, 'success');
        assert.equal(failures.length, 0);
    });

    it('failed: zero updates, TaskRecord still appended with the failed traffic fields, routed to recordFlowFailure', () => {
        const { deps, updates, appended, flowEvents, failures } = makeDeps([makeProfile()]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult({
                status: 'failed',
                content: undefined,
                error: 'HTTP 404',
                method: 'fallback',
                profileUpload: 0,
                profileDownload: 0,
                profileTotal: 0,
                profileExpire: 0,
            }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0003',
        });

        assert.deepEqual(outcome, { status: 'recorded', targetProfileId: 'prof_a' });
        assert.deepEqual(updates, []);
        // 锁定当前行为：记录携带失败结果的流量字段（此处为零），而不是被丢弃。
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
        const { deps, updates, flowEvents, failures } = makeDeps([makeProfile()]);
        const outcome = applyRefreshResult(deps, {
            result: makeResult({ status: 'skipped', content: undefined }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0004',
        });
        assert.deepEqual(outcome, { status: 'recorded', targetProfileId: 'prof_a' });
        assert.deepEqual(updates, []);
        assert.equal(failures.length, 0);
        assert.equal(flowEvents[0].status, 'skip');
    });

    it('actualUrl present → acceleratedUrlRedacted via redactUrl; absent → undefined', () => {
        const accelerated = 'https://accel.example.invalid/u/abc?k=v';
        const withUrl = makeDeps([makeProfile()]);
        applyRefreshResult(withUrl.deps, {
            result: makeResult({ actualUrl: accelerated }),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0005',
        });
        assert.equal(withUrl.appended[0].record.acceleratedUrlRedacted, redactUrl(accelerated));

        const withoutUrl = makeDeps([makeProfile()]);
        applyRefreshResult(withoutUrl.deps, {
            result: makeResult(),
            url: URL,
            trigger: 'auto',
            flowId: 'flow0006',
        });
        assert.equal(withoutUrl.appended[0].record.acceleratedUrlRedacted, undefined);
    });

    it('method defaults to primary in both the record and the event', () => {
        const { deps, appended, flowEvents } = makeDeps([makeProfile()]);
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
        const { deps, flowEvents } = makeDeps([makeProfile()]);
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

describe('resolveResultOriginUrl', () => {
    it('configUrl present: taken verbatim regardless of the active url', () => {
        assert.deepEqual(
            resolveResultOriginUrl({ configUrl: URL }, URL_B),
            { url: URL, legacy: false },
        );
    });

    it('configUrl missing (legacy native result): falls back to the active url, flagged legacy', () => {
        assert.deepEqual(
            resolveResultOriginUrl({}, URL_B),
            { url: URL_B, legacy: true },
        );
    });

    it('configUrl and active url both missing: null, not legacy', () => {
        assert.deepEqual(
            resolveResultOriginUrl({}, null),
            { url: null, legacy: false },
        );
    });
});
