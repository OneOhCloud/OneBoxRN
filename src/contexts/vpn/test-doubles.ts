/**
 * Hand-rolled fakes shared by the vpn pure-core test suites.
 * No mocking library — matches repo test conventions. Imported only
 * by *.test.ts files; never by app code.
 */

import type { TimerHost, VpnBridge, VpnLogger } from './types.ts';

// ─── Fake timers ─────────────────────────────────────────────

export interface FakeTimers {
    host: TimerHost;
    /** Fires the oldest pending timer. Returns false when none pending. */
    fireNext(): boolean;
    /** Fires until the queue drains (new timers scheduled mid-run included). */
    fireAll(): void;
    pendingCount(): number;
    pendingDelays(): number[];
}

export function createFakeTimers(): FakeTimers {
    let nextId = 1;
    const pending = new Map<number, { fn: () => void; ms: number }>();

    const timers: FakeTimers = {
        host: {
            setTimeout(fn, ms) {
                const id = nextId++;
                pending.set(id, { fn, ms });
                return id;
            },
            clearTimeout(handle) {
                if (typeof handle === 'number') pending.delete(handle);
            },
        },
        fireNext() {
            const first = pending.entries().next();
            if (first.done) return false;
            const [id, timer] = first.value;
            pending.delete(id);
            timer.fn();
            return true;
        },
        fireAll() {
            while (timers.fireNext()) {
                // drain, including timers scheduled by fired callbacks
            }
        },
        pendingCount: () => pending.size,
        pendingDelays: () => [...pending.values()].map((t) => t.ms),
    };
    return timers;
}

// ─── Silent logger with call capture ─────────────────────────

export interface CapturingLogger extends VpnLogger {
    lines: string[];
}

export function createLogger(): CapturingLogger {
    const lines: string[] = [];
    const push = (level: string) => (msg: string) => {
        lines.push(`${level} ${msg}`);
    };
    return {
        lines,
        debug: push('debug'),
        info: push('info'),
        warn: push('warn'),
        error: push('error'),
    };
}

// ─── Fake bridge ─────────────────────────────────────────────

export interface FakeBridge extends VpnBridge {
    /** Mutable current status returned by getStatus(). */
    status: number;
    /** Emit a native status-change event to all live listeners. */
    emitStatus(status: number): void;
    calls: string[];
    /** Overridable behaviors; default resolve. */
    behaviors: {
        stop: () => Promise<void>;
        start: (config: string) => Promise<void>;
        checkVpnPermission: () => Promise<boolean>;
        requestVpnPermission: () => Promise<boolean>;
        selectProxyNode: (tag: string) => Promise<boolean>;
        triggerURLTest: (tag: string) => Promise<boolean>;
    };
    listenerCount(): number;
}

export function createFakeBridge(initialStatus: number): FakeBridge {
    const listeners = new Set<(status: number) => void>();
    const bridge: FakeBridge = {
        status: initialStatus,
        calls: [],
        behaviors: {
            stop: () => Promise.resolve(),
            start: () => Promise.resolve(),
            checkVpnPermission: () => Promise.resolve(true),
            requestVpnPermission: () => Promise.resolve(true),
            selectProxyNode: () => Promise.resolve(true),
            triggerURLTest: () => Promise.resolve(true),
        },
        getStatus() {
            return bridge.status;
        },
        start(config: string) {
            bridge.calls.push(`start:${config}`);
            return bridge.behaviors.start(config);
        },
        stop() {
            bridge.calls.push('stop');
            return bridge.behaviors.stop();
        },
        checkVpnPermission() {
            bridge.calls.push('checkVpnPermission');
            return bridge.behaviors.checkVpnPermission();
        },
        requestVpnPermission() {
            bridge.calls.push('requestVpnPermission');
            return bridge.behaviors.requestVpnPermission();
        },
        selectProxyNode(tag: string) {
            bridge.calls.push(`selectProxyNode:${tag}`);
            return bridge.behaviors.selectProxyNode(tag);
        },
        triggerURLTest(tag: string) {
            bridge.calls.push(`triggerURLTest:${tag}`);
            return bridge.behaviors.triggerURLTest(tag);
        },
        addStatusListener(cb) {
            listeners.add(cb);
            return {
                remove() {
                    listeners.delete(cb);
                },
            };
        },
        emitStatus(status: number) {
            bridge.status = status;
            [...listeners].forEach((cb) => cb(status));
        },
        listenerCount: () => listeners.size,
    };
    return bridge;
}

/** Lets async chains (then/finally) settle between fake-timer fires. */
export async function flushMicrotasks(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve();
    }
}
