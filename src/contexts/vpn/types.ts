/**
 * Pure types for the VpnContext action layer.
 *
 * Dependency-free of expo / react-native / `@/` aliases so the sibling
 * pure cores (actions.ts, restart-machine.ts, node-store-core.ts) and
 * their node:test suites load under `--experimental-strip-types`.
 *
 * Actions report failures as typed results instead of throwing across
 * the context boundary — presentation (Alert / ErrorView / i18n) stays
 * in the UI layer.
 */

export interface StartOptions {
    /**
     * Wall-clock cap racing the native start. Omit = wait indefinitely
     * (home-screen behavior). On timeout the native start keeps running
     * in the background — same property as the previous Promise.race.
     */
    timeoutMs?: number;
    /**
     * Checked at phase boundaries (permission → config → start). Cannot
     * cancel an in-flight native start.
     */
    signal?: AbortSignal;
}

export type StartFailure =
    | { kind: 'permission-denied' }
    | { kind: 'aborted' }
    | { kind: 'timeout'; timeoutMs: number }
    | { kind: 'config-error'; message: string }
    | { kind: 'native-error'; message: string };

export type StartResult = { ok: true } | { ok: false; failure: StartFailure };

export interface StopOptions {
    /** How long to wait for the STOPPED status event. Default 10_000. */
    timeoutMs?: number;
}

export type StopResult =
    /** STOPPED status event observed. */
    | { outcome: 'stopped' }
    /** Status was not STARTED/STARTING; no native call issued. */
    | { outcome: 'already-stopped' }
    /** No STOPPED event within timeoutMs; native stop may still land. */
    | { outcome: 'timeout' }
    /** Native stop() rejected; resolved after a 300 ms grace window. */
    | { outcome: 'stop-rejected'; message: string };

export type SelectNodeResult = { ok: true } | { ok: false; message: string };

/**
 * Minimal surface of ExpoOneBox the action layer needs — injected so
 * the pure cores never import the native module.
 */
export interface VpnBridge {
    getStatus(): number;
    start(config: string): Promise<void>;
    stop(): Promise<void>;
    checkVpnPermission(): Promise<boolean>;
    requestVpnPermission(): Promise<boolean>;
    selectProxyNode(tag: string): Promise<boolean>;
    triggerURLTest(tag: string): Promise<boolean>;
    addStatusListener(cb: (status: number) => void): { remove(): void };
}

/** Union with number so fake timer hosts in tests can hand out plain ids. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface TimerHost {
    setTimeout(fn: () => void, ms: number): TimerHandle;
    clearTimeout(handle: TimerHandle): void;
}

export const defaultTimers: TimerHost = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
};

export interface VpnLogger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}
