import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VPN_STATUS } from '../../modules/expo-onebox/src/ExpoOneBox.types.ts';
import { createVpnActions, stopAndAwaitStopped, TRIGGER_THROTTLE_MS, type VpnActionDeps } from './actions.ts';
import { createNodeStore } from './node-store-core.ts';
import {
    createFakeBridge,
    createFakeTimers,
    createLogger,
    flushMicrotasks,
    type FakeBridge,
    type FakeTimers,
} from './test-doubles.ts';

function makeDeps(bridge: FakeBridge, timers: FakeTimers, overrides?: Partial<VpnActionDeps>) {
    const deps: VpnActionDeps = {
        bridge,
        platform: 'ios',
        getProcessedConfig: () => Promise.resolve('{"cfg":1}'),
        nodeStore: createNodeStore({ timers: timers.host }),
        log: createLogger(),
        timers: timers.host,
        ...overrides,
    };
    return deps;
}

describe('stopAndAwaitStopped', () => {
    it('resolves already-stopped without calling native stop', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        const result = await stopAndAwaitStopped(
            { bridge, log: createLogger(), timers: timers.host },
            10_000,
        );
        assert.deepEqual(result, { outcome: 'already-stopped' });
        assert.deepEqual(bridge.calls, []);
    });

    it('resolves stopped on the STOPPED event and cleans up', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const promise = stopAndAwaitStopped(
            { bridge, log: createLogger(), timers: timers.host },
            10_000,
        );
        await flushMicrotasks();
        assert.equal(bridge.listenerCount(), 1);

        bridge.emitStatus(VPN_STATUS.STOPPING);
        bridge.emitStatus(VPN_STATUS.STOPPED);
        assert.deepEqual(await promise, { outcome: 'stopped' });
        assert.equal(bridge.listenerCount(), 0);
        assert.equal(timers.pendingCount(), 0);
    });

    it('resolves timeout when no STOPPED arrives in time', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const promise = stopAndAwaitStopped(
            { bridge, log: createLogger(), timers: timers.host },
            10_000,
        );
        await flushMicrotasks();
        timers.fireAll();
        assert.deepEqual(await promise, { outcome: 'timeout' });
        assert.equal(bridge.listenerCount(), 0);
    });

    it('stop() rejection logs the warning and arms the 300 ms grace window', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.stop = () => Promise.reject(new Error('busy'));
        const log = createLogger();
        void stopAndAwaitStopped({ bridge, log, timers: timers.host }, 10_000);
        await flushMicrotasks();

        assert.ok(log.lines.some((l) => l.includes('stop() rejected')));
        // reject handler 在仍待执行的外层超时之外再安排宽限 fallback ——
        // 两个 timer，各守一个边界。
        assert.deepEqual(timers.pendingDelays().sort((a, b) => a - b), [300, 10_000]);
    });

    it('a rejected stop() with no STOPPED still settles and tears down the listener', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.stop = () => Promise.reject(new Error('busy'));
        const promise = stopAndAwaitStopped(
            { bridge, log: createLogger(), timers: timers.host },
            10_000,
        );
        await flushMicrotasks();

        // fake 调度器按最旧优先触发 timer；外层超时在宽限窗口之前装载，因此
        // 它会确定性地 settle 这次等待。（在真实按 delay 排序的 timer 下，300ms
        // 宽限会先触发并产出 'stop-rejected'；该路径在按插入序的 fake 下不可达。）
        // 被测保证：等待总会 settle 并退订，而非在被 reject 的 stop() 上挂起。
        timers.fireAll();
        assert.deepEqual(await promise, { outcome: 'timeout' });
        assert.equal(bridge.listenerCount(), 0);
        assert.equal(timers.pendingCount(), 0);
    });

    it('STOPPED arriving during the reject grace window wins', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.stop = () => Promise.reject(new Error('busy'));
        const promise = stopAndAwaitStopped(
            { bridge, log: createLogger(), timers: timers.host },
            10_000,
        );
        await flushMicrotasks();
        bridge.emitStatus(VPN_STATUS.STOPPED);
        assert.deepEqual(await promise, { outcome: 'stopped' });
    });
});

describe('createVpnActions.start', () => {
    it('android: denied permission fails without touching config or native start', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        bridge.behaviors.checkVpnPermission = () => Promise.resolve(false);
        bridge.behaviors.requestVpnPermission = () => Promise.resolve(false);
        let configReads = 0;
        const actions = createVpnActions(
            makeDeps(bridge, timers, {
                platform: 'android',
                getProcessedConfig: () => {
                    configReads += 1;
                    return Promise.resolve('{}');
                },
            }),
        );
        const result = await actions.start();
        assert.deepEqual(result, { ok: false, failure: { kind: 'permission-denied' } });
        assert.equal(configReads, 0);
        assert.ok(!bridge.calls.some((c) => c.startsWith('start:')));
    });

    it('a rejecting permission bridge maps to native-error instead of throwing', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        bridge.behaviors.checkVpnPermission = () =>
            Promise.reject(new Error('SecurityException: lockdown VPN enabled'));
        const actions = createVpnActions(makeDeps(bridge, timers, { platform: 'android' }));
        assert.deepEqual(await actions.start(), {
            ok: false,
            failure: { kind: 'native-error', message: 'SecurityException: lockdown VPN enabled' },
        });
        assert.ok(!bridge.calls.some((c) => c.startsWith('start:')));
    });

    it('android: granted-on-request proceeds to native start', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        bridge.behaviors.checkVpnPermission = () => Promise.resolve(false);
        bridge.behaviors.requestVpnPermission = () => Promise.resolve(true);
        const actions = createVpnActions(makeDeps(bridge, timers, { platform: 'android' }));
        assert.deepEqual(await actions.start(), { ok: true });
        assert.ok(bridge.calls.includes('start:{"cfg":1}'));
    });

    it('non-android skips the permission gate entirely', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        const actions = createVpnActions(makeDeps(bridge, timers));
        assert.deepEqual(await actions.start(), { ok: true });
        assert.ok(!bridge.calls.includes('checkVpnPermission'));
    });

    it('web starts with an empty mock config', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        const actions = createVpnActions(
            makeDeps(bridge, timers, {
                platform: 'web',
                getProcessedConfig: () => Promise.reject(new Error('must not be called')),
            }),
        );
        assert.deepEqual(await actions.start(), { ok: true });
        assert.ok(bridge.calls.includes('start:{}'));
    });

    it('config processing failure maps to config-error', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        const actions = createVpnActions(
            makeDeps(bridge, timers, {
                getProcessedConfig: () => Promise.reject(new Error('no template')),
            }),
        );
        assert.deepEqual(await actions.start(), {
            ok: false,
            failure: { kind: 'config-error', message: 'no template' },
        });
    });

    it('native start rejection maps to native-error', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        bridge.behaviors.start = () => Promise.reject(new Error('tunnel busy'));
        const actions = createVpnActions(makeDeps(bridge, timers));
        assert.deepEqual(await actions.start(), {
            ok: false,
            failure: { kind: 'native-error', message: 'tunnel busy' },
        });
    });

    it('timeout race: slow native start resolves timeout; timer cleared on success', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        bridge.behaviors.start = () => new Promise(() => {}); // 永不 settle
        const actions = createVpnActions(makeDeps(bridge, timers));
        const promise = actions.start({ timeoutMs: 20_000 });
        await flushMicrotasks();
        timers.fireAll();
        assert.deepEqual(await promise, {
            ok: false,
            failure: { kind: 'timeout', timeoutMs: 20_000 },
        });

        // 快速路径会清掉赛跑的 timer。
        bridge.behaviors.start = () => Promise.resolve();
        assert.deepEqual(await actions.start({ timeoutMs: 20_000 }), { ok: true });
        assert.equal(timers.pendingCount(), 0);
    });

    it('a pre-aborted signal short-circuits before any bridge call', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        const controller = new AbortController();
        controller.abort();
        const actions = createVpnActions(makeDeps(bridge, timers, { platform: 'android' }));
        assert.deepEqual(await actions.start({ signal: controller.signal }), {
            ok: false,
            failure: { kind: 'aborted' },
        });
        assert.deepEqual(bridge.calls, []);
    });

    it('abort between config and native start prevents the start call', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STOPPED);
        const controller = new AbortController();
        const actions = createVpnActions(
            makeDeps(bridge, timers, {
                getProcessedConfig: () => {
                    controller.abort(); // 生成配置期间中止
                    return Promise.resolve('{}');
                },
            }),
        );
        assert.deepEqual(await actions.start({ signal: controller.signal }), {
            ok: false,
            failure: { kind: 'aborted' },
        });
        assert.ok(!bridge.calls.some((c) => c.startsWith('start:')));
    });
});

describe('createVpnActions node actions', () => {
    it('selectNode success marks the store current node', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        assert.deepEqual(await actions.selectNode('hk-01'), { ok: true });
        assert.equal(nodeStore.getSnapshot().currentNode, 'hk-01');
    });

    it('selectNode failure returns the message and leaves the store alone', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.selectProxyNode = () => Promise.reject(new Error('no such node'));
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        assert.deepEqual(await actions.selectNode('nope'), {
            ok: false,
            message: 'no such node',
        });
        assert.equal(nodeStore.getSnapshot().currentNode, '');
    });

    it('selectNode treats a native false (Android failure) as failure and leaves the store alone', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.selectProxyNode = () => Promise.resolve(false);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        assert.deepEqual(await actions.selectNode('nope'), { ok: false, message: '' });
        assert.equal(nodeStore.getSnapshot().currentNode, '');
    });

    it('triggerNodeTests opens the window and fires only the auto group test', async () => {
        // 单轮扫描：对 selector 的第二次触发会让每个节点被两条探测同时打，
        // 并发翻倍互相挤占 → 延迟虚高（本轮修复的核心回归锁）。
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        actions.triggerNodeTests();
        assert.equal(nodeStore.getSnapshot().isLoading, true);
        assert.equal(nodeStore.getSnapshot().isSweeping, true);
        assert.deepEqual(
            bridge.calls.filter((c) => c.startsWith('triggerURLTest:')),
            ['triggerURLTest:auto'],
        );
        await flushMicrotasks();
    });

    it('triggerNodeTests outside STARTED neither calls the bridge nor opens a window', () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTING);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        actions.triggerNodeTests();
        assert.deepEqual(bridge.calls, []);
        assert.equal(nodeStore.getSnapshot().isLoading, false);
        assert.equal(nodeStore.getSnapshot().isSweeping, false);
        assert.equal(timers.pendingCount(), 0);
    });

    it('a native false cancels the testing window', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.triggerURLTest = () => Promise.resolve(false);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        actions.triggerNodeTests();
        assert.equal(nodeStore.getSnapshot().isSweeping, true);
        await flushMicrotasks();
        assert.equal(nodeStore.getSnapshot().isSweeping, false);
        assert.equal(nodeStore.getSnapshot().isLoading, false);
        assert.equal(timers.pendingCount(), 0);
    });

    it('a native rejection cancels the testing window', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        bridge.behaviors.triggerURLTest = () => Promise.reject(new Error('ipc dead'));
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        actions.triggerNodeTests();
        await flushMicrotasks();
        assert.equal(nodeStore.getSnapshot().isSweeping, false);
        assert.equal(nodeStore.getSnapshot().isLoading, false);
    });

    it('throttles repeat triggers within the window and allows them after it', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const nodeStore = createNodeStore({ timers: timers.host });
        let nowMs = 0;
        const actions = createVpnActions(
            makeDeps(bridge, timers, { nodeStore, now: () => nowMs }),
        );

        actions.triggerNodeTests();
        nowMs = TRIGGER_THROTTLE_MS - 1;
        actions.triggerNodeTests();
        assert.equal(bridge.calls.filter((c) => c.startsWith('triggerURLTest:')).length, 1);

        nowMs = TRIGGER_THROTTLE_MS;
        actions.triggerNodeTests();
        assert.equal(bridge.calls.filter((c) => c.startsWith('triggerURLTest:')).length, 2);
        await flushMicrotasks();
    });

    it('resetNodes clears the store and the trigger throttle', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const nodeStore = createNodeStore({ timers: timers.host });
        let nowMs = 0;
        const actions = createVpnActions(
            makeDeps(bridge, timers, { nodeStore, now: () => nowMs }),
        );
        nodeStore.markCurrentNode('x');
        actions.triggerNodeTests();
        actions.resetNodes();
        assert.equal(nodeStore.getSnapshot().currentNode, '');

        // 断开→快速重连场景：节流已清，立即可再测。
        nowMs = 1;
        actions.triggerNodeTests();
        assert.equal(bridge.calls.filter((c) => c.startsWith('triggerURLTest:')).length, 2);
        await flushMicrotasks();
    });
});
