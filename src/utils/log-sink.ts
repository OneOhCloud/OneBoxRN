/**
 * 日志存储 —— 多来源日志流的单一事实来源。
 *
 * 暴露一个可监听的环形缓冲区（容量 1000）以及基于 `useSyncExternalStore`
 * 的 `useLogs()` hook。`VpnContext` 里的原生监听器直接写入本存储；JS 辅助
 * 函数调用 `jsLog.*`；日志查看器通过 `useLogs()` 监听。
 *
 * 为何用独立存储（而非 React context 状态）：
 *   - 缓冲区深达 1000 时，每来一行日志都会让 VpnContext 的所有消费者
 *     （主屏、设置、模式选择器等）重渲染。把日志移出 context，可把热路径
 *     隔离到真正显示它们的屏幕。
 *   - `useSyncExternalStore` 防撕裂，在并发渲染下安全。
 */
import { useSyncExternalStore } from 'react';

export type LogSource = 'sing-box' | 'native' | 'js';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    id: number;
    source: LogSource;
    level: LogLevel;
    message: string;
    time: number;
}

// ── 环形缓冲区 ─────────────────────────────────────────────

const BUFFER_LIMIT = 1000;

let buffer: LogEntry[] = [];
let nextId = 1;

type Listener = (entry: LogEntry | null) => void;
const listeners = new Set<Listener>();

function getSnapshot(): LogEntry[] {
    return buffer;
}

function notify(entry: LogEntry | null) {
    for (const l of listeners) {
        try {
            l(entry);
        } catch {
            // 吞掉 —— 某个监听者抛错不能拖垮发射方
        }
    }
}

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

// ── 公开的 emit / clear API ─────────────────────────────────

export function emitLog(
    partial: { source: LogSource; level: LogLevel; message: string; time?: number }
): void {
    const entry: LogEntry = {
        id: nextId++,
        source: partial.source,
        level: partial.level,
        message: partial.message,
        time: partial.time ?? Date.now(),
    };
    buffer = buffer.length >= BUFFER_LIMIT
        ? [...buffer.slice(buffer.length - BUFFER_LIMIT + 1), entry]
        : [...buffer, entry];
    notify(entry);
}

export function clearLogSink(): void {
    if (buffer.length === 0) return;
    buffer = [];
    notify(null);
}

/**
 * 返回缓冲区里最近的 count 条日志（时间正序）。
 * 供启动失败诊断在失败时刻快照上下文 —— 不订阅、不触发通知。
 */
export function getRecentLogs(count: number): LogEntry[] {
    if (count <= 0) return [];
    return buffer.slice(-count);
}

// ── React hook ──────────────────────────────────────────────

/**
 * 对 React 监听器的通知做了去抖 —— sing-box 核心每秒可发出数十行；每行都
 * 通知一次 React 会为每行强制整屏重渲染日志查看器，被 VirtualizedList 标记
 * 为慢渲染。底层缓冲区仍同步更新，因此 `getSnapshot()` 始终反映最新状态；
 * 只是把重渲染节奏限制在约 20fps。
 */
const REACT_NOTIFY_INTERVAL_MS = 50;

function subscribeForReact(cb: () => void): () => void {
    let scheduled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
        if (scheduled) return;
        scheduled = true;
        timer = setTimeout(() => {
            scheduled = false;
            timer = null;
            cb();
        }, REACT_NOTIFY_INTERVAL_MS);
    };
    const unsub = subscribe(fire);
    return () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        unsub();
    };
}

export function useLogs(): LogEntry[] {
    return useSyncExternalStore(subscribeForReact, getSnapshot, getSnapshot);
}

// ── JS 层发布者 ──────────────────────────────────────

function safeStringify(value: unknown): string {
    if (value instanceof Error) return value.stack || value.message;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function publishJs(level: LogLevel, args: unknown[]): void {
    const message = args
        .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
        .join(' ');
    emitLog({ source: 'js', level, message });
}

export const jsLog = {
    debug(...args: unknown[]): void {
        console.log(...args);
        publishJs('debug', args);
    },
    info(...args: unknown[]): void {
        console.log(...args);
        publishJs('info', args);
    },
    warn(...args: unknown[]): void {
        console.warn(...args);
        publishJs('warn', args);
    },
    error(...args: unknown[]): void {
        console.error(...args);
        publishJs('error', args);
    },
};
