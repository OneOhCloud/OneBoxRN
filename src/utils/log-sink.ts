/**
 * Log store — single source of truth for the multi-source log stream.
 *
 * Exposes a subscribable ring buffer (capacity 1000) plus a
 * `useSyncExternalStore`-based `useLogs()` hook. Native listeners in
 * `VpnContext` emit directly into this store; JS helpers call
 * `jsLog.*`; the Logs viewer subscribes via `useLogs()`.
 *
 * Why a dedicated store (not React context state):
 *   - Every new log line would rerender every consumer of VpnContext
 *     (home screen, settings, mode selector, etc.) when the buffer is
 *     1000 deep. Lifting logs out of context keeps the hot path isolated
 *     to screens that actually display them.
 *   - `useSyncExternalStore` tearing-safe; safe across concurrent renders.
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

// ── Ring buffer ─────────────────────────────────────────────

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
            // swallow — a subscriber throwing must not break the emitter
        }
    }
}

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

// ── Public emit / clear API ─────────────────────────────────

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

export function getLogSnapshot(): LogEntry[] {
    return buffer;
}

// Legacy low-level subscribe — kept for any non-React consumer.
export function subscribeLogSink(listener: (entry: LogEntry) => void): () => void {
    const wrapped: Listener = (e) => { if (e) listener(e); };
    return subscribe(wrapped);
}

// ── React hook ──────────────────────────────────────────────

/**
 * React listener notification is debounced — sing-box core can emit dozens of
 * lines per second; notifying React once per line would force a full
 * render of the Logs viewer for each one, which VirtualizedList flags
 * as slow (`dt: 2907ms`). The underlying buffer still updates
 * synchronously, so `getSnapshot()` always reflects the latest state;
 * only the re-render cadence is capped to ≈20fps.
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

// ── JS-layer publisher ──────────────────────────────────────

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
