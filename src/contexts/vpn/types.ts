/**
 * VpnContext action 层的纯类型。
 *
 * 不依赖 expo / react-native / `@/` 别名，使同级纯核心（actions.ts、
 * restart-machine.ts、node-store-core.ts）及其 node:test 套件能在
 * `--experimental-strip-types` 下加载。
 *
 * Action 以类型化结果报告失败，而非跨 context 边界抛异常 —— 呈现
 *（Alert / ErrorView / i18n）留在 UI 层。
 */

export interface StartOptions {
    /**
     * 与原生 start 赛跑的挂钟上限。省略 = 无限等待（home 屏行为）。超时后
     * 原生 start 仍在后台继续运行。
     */
    timeoutMs?: number;
    /**
     * 在各阶段边界检查（permission → config → start）。无法取消已在途的
     * 原生 start。
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
    /** 等待 STOPPED 状态事件的时长。默认 10_000。 */
    timeoutMs?: number;
}

export type StopResult =
    /** 观察到 STOPPED 状态事件。 */
    | { outcome: 'stopped' }
    /** 状态不是 STARTED/STARTING；未发起原生调用。 */
    | { outcome: 'already-stopped' }
    /** timeoutMs 内未收到 STOPPED；原生 stop 仍可能稍后到达。 */
    | { outcome: 'timeout' }
    /** 原生 stop() reject；在 300ms 宽限窗口后 resolve。 */
    | { outcome: 'stop-rejected'; message: string };

export type SelectNodeResult = { ok: true } | { ok: false; message: string };

/**
 * action 层所需的 ExpoOneBox 最小接口 —— 注入使用，使纯核心绝不 import
 * 原生模块。
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

/** 与 number 联合，使测试中的 fake timer host 能派发普通数字 id。 */
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
