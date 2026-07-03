import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VPN_STATUS } from '../../modules/expo-onebox/src/ExpoOneBox.types.ts';
import { createVpnActions, stopAndAwaitStopped, type VpnActionDeps } from './actions.ts';
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
        // The reject handler schedules the grace fallback alongside the
        // still-pending outer timeout — two timers, one per bound.
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

        // The fake scheduler fires timers oldest-first; the outer timeout was
        // armed before the grace window, so it deterministically settles the
        // wait. (Under real delay-ordered timers the 300 ms grace fires first
        // and yields 'stop-rejected'; that path is unreachable with an
        // insertion-order fake.) The guarantee under test: the wait always
        // settles and unsubscribes rather than hanging on a rejected stop().
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
        bridge.behaviors.start = () => new Promise(() => {}); // never settles
        const actions = createVpnActions(makeDeps(bridge, timers));
        const promise = actions.start({ timeoutMs: 20_000 });
        await flushMicrotasks();
        timers.fireAll();
        assert.deepEqual(await promise, {
            ok: false,
            failure: { kind: 'timeout', timeoutMs: 20_000 },
        });

        // Fast path clears the racing timer.
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
                    controller.abort(); // aborted while producing the config
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

    it('triggerNodeTests opens the window and fires both group tests', async () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        actions.triggerNodeTests();
        assert.equal(nodeStore.getSnapshot().isLoading, true);
        assert.deepEqual(
            bridge.calls.filter((c) => c.startsWith('triggerURLTest:')),
            ['triggerURLTest:ExitGateway', 'triggerURLTest:auto'],
        );
        await flushMicrotasks();
    });

    it('resetNodes clears the store', () => {
        const timers = createFakeTimers();
        const bridge = createFakeBridge(VPN_STATUS.STARTED);
        const nodeStore = createNodeStore({ timers: timers.host });
        const actions = createVpnActions(makeDeps(bridge, timers, { nodeStore }));
        nodeStore.markCurrentNode('x');
        actions.resetNodes();
        assert.equal(nodeStore.getSnapshot().currentNode, '');
    });
});
