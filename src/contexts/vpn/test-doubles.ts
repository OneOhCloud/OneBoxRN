/**
 * vpn 纯核心测试套件共享的手写 fake。不使用 mock 库 —— 遵循仓库测试约定。
 * 仅由 *.test.ts 文件 import；绝不由应用代码 import。
 */

import type { TimerHost, VpnBridge, VpnLogger } from './types.ts';

// ─── Fake timers ─────────────────────────────────────────────

export interface FakeTimers {
    host: TimerHost;
    /** 触发最旧的待执行 timer。无待执行时返回 false。 */
    fireNext(): boolean;
    /** 一直触发直到队列排空（含运行中新安排的 timer）。 */
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
                // 排空，含被已触发回调安排的 timer
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
    /** getStatus() 返回的可变当前状态。 */
    status: number;
    /** 向所有存活监听器发出一次原生状态变更事件。 */
    emitStatus(status: number): void;
    calls: string[];
    /** 可覆盖的行为；默认 resolve。 */
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

/** 让异步链（then/finally）在 fake-timer 触发之间 settle。 */
export async function flushMicrotasks(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve();
    }
}
