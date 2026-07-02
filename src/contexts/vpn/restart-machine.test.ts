import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VPN_STATUS } from '../../modules/expo-onebox/src/ExpoOneBox.types.ts';
import { createRestartMachine, type RestartMachineDeps } from './restart-machine.ts';
import type { StopResult } from './types.ts';
import { createFakeTimers, createLogger, flushMicrotasks, type CapturingLogger, type FakeTimers } from './test-doubles.ts';

interface Harness {
    timers: FakeTimers;
    log: CapturingLogger;
    machine: ReturnType<typeof createRestartMachine>;
    calls: string[];
    setStatus(status: number): void;
    setStopResult(result: StopResult): void;
    failNextStart(message: string): void;
}

function makeHarness(): Harness {
    const timers = createFakeTimers();
    const log = createLogger();
    const calls: string[] = [];
    let status: number = VPN_STATUS.STARTED;
    let stopResult: StopResult = { outcome: 'stopped' };
    let startError: string | null = null;

    const deps: RestartMachineDeps = {
        getStatus: () => status,
        stopAndWait(timeoutMs: number) {
            calls.push(`stopAndWait:${timeoutMs}`);
            return Promise.resolve(stopResult);
        },
        getConfig() {
            calls.push('getConfig');
            return Promise.resolve('{"fresh":true}');
        },
        start(config: string) {
            calls.push(`start:${config}`);
            if (startError !== null) {
                const message = startError;
                startError = null;
                return Promise.reject(new Error(message));
            }
            return Promise.resolve();
        },
        log,
        timers: timers.host,
    };

    return {
        timers,
        log,
        machine: createRestartMachine(deps),
        calls,
        setStatus: (s) => {
            status = s;
        },
        setStopResult: (r) => {
            stopResult = r;
        },
        failNextStart: (message) => {
            startError = message;
        },
    };
}

describe('createRestartMachine', () => {
    it('is a no-op while the tunnel is stopped', () => {
        const h = makeHarness();
        h.setStatus(VPN_STATUS.STOPPED);
        h.machine.request();
        assert.equal(h.timers.pendingCount(), 0);
        assert.deepEqual(h.calls, []);
    });

    it('collapses a burst of requests into one debounced cycle', async () => {
        const h = makeHarness();
        h.machine.request();
        h.machine.request();
        h.machine.request();
        assert.equal(h.timers.pendingCount(), 1); // one debounce timer

        h.timers.fireAll();
        await flushMicrotasks();
        assert.deepEqual(h.calls, ['stopAndWait:10000', 'getConfig', 'start:{"fresh":true}']);
    });

    it('re-checks status after the debounce — disconnect aborts the cycle', async () => {
        const h = makeHarness();
        h.machine.request();
        h.setStatus(VPN_STATUS.STOPPED); // user tapped Disconnect mid-debounce
        h.timers.fireAll();
        await flushMicrotasks();
        assert.deepEqual(h.calls, []);
    });

    it('requests during an in-flight cycle schedule exactly one rerun', async () => {
        const h = makeHarness();
        let releaseStop: (r: StopResult) => void = () => {};
        const gate = new Promise<StopResult>((resolve) => {
            releaseStop = resolve;
        });
        const deps: RestartMachineDeps = {
            getStatus: () => VPN_STATUS.STARTED,
            stopAndWait: () => {
                h.calls.push('stopAndWait');
                return gate.then((r) => r);
            },
            getConfig: () => {
                h.calls.push('getConfig');
                return Promise.resolve('{}');
            },
            start: (c) => {
                h.calls.push(`start:${c}`);
                return Promise.resolve();
            },
            log: h.log,
            timers: h.timers.host,
        };
        const machine = createRestartMachine(deps);

        machine.request();
        h.timers.fireAll(); // debounce fires; cycle now blocked on stop gate
        await flushMicrotasks();
        assert.deepEqual(h.calls, ['stopAndWait']);

        machine.request(); // lands in-flight → needsReRun
        machine.request(); // still exactly one rerun
        assert.equal(h.timers.pendingCount(), 0); // no new debounce while in flight

        releaseStop({ outcome: 'stopped' });
        await flushMicrotasks();
        // rerun scheduled once after rearm delay
        assert.deepEqual(h.timers.pendingDelays(), [400]);
        h.timers.fireAll();
        await flushMicrotasks();
        assert.deepEqual(h.calls, [
            'stopAndWait',
            'getConfig',
            'start:{}',
            'stopAndWait',
            'getConfig',
            'start:{}',
        ]);
        assert.equal(h.timers.pendingCount(), 0); // no third cycle
    });

    it('stop timeout still proceeds to start and logs a warning', async () => {
        const h = makeHarness();
        h.setStopResult({ outcome: 'timeout' });
        h.machine.request();
        h.timers.fireAll();
        await flushMicrotasks();
        assert.ok(h.calls.some((c) => c.startsWith('start:')));
        assert.ok(h.log.lines.some((l) => l.includes('stop timeout')));
    });

    it('start failure logs a warning and releases the in-flight guard', async () => {
        const h = makeHarness();
        h.failNextStart('boot failed');
        h.machine.request();
        h.timers.fireAll();
        await flushMicrotasks();
        assert.ok(h.log.lines.some((l) => l.includes('Restart failed') && l.includes('boot failed')));

        // Guard released: a fresh request debounces and runs a new cycle.
        h.machine.request();
        h.timers.fireAll();
        await flushMicrotasks();
        assert.equal(h.calls.filter((c) => c.startsWith('start:')).length, 2);
    });
});
