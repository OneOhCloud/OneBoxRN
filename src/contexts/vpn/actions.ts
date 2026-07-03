/**
 * VpnContext 的 action 层 —— 依赖注入的纯核心。
 *
 * 连接 / 断开 / 节点流程的单一实现。所有失败以类型化结果呈现（见
 * types.ts）；此处不跨边界抛异常，也不呈现 UI。
 */

import { VPN_STATUS } from '../../modules/expo-onebox/src/ExpoOneBox.types.ts';
import type {
    SelectNodeResult,
    StartFailure,
    StartOptions,
    StartResult,
    StopOptions,
    StopResult,
    TimerHandle,
    TimerHost,
    VpnBridge,
    VpnLogger,
} from './types.ts';
import { defaultTimers } from './types.ts';
import type { NodeStore } from './node-store-core.ts';
import { AUTO_GROUP_TAG, GATEWAY_GROUP_TAG } from './node-store-core.ts';
import { errorCodeFromMessage } from '../../utils/config-fetch-policy.ts';

const DEFAULT_STOP_TIMEOUT_MS = 10_000;
/** 原生 stop() 在 reject 后仍可能发出 STOPPED —— 宽限窗口。 */
const STOP_REJECT_GRACE_MS = 300;

/**
 * 把启动失败映射到用于遥测的共享 errorCode 词表。
 * permission-denied / timeout / aborted 映射为固定 token；config-error 与
 * native-error 携带真实原生字符串，经 fetch-policy 核心分类。这是 import
 * 流程与 home 开关共用的唯一映射器 —— 使两者的 vpn_toggle / config_import
 * 失败码保持一致。
 */
export function startFailureErrorCode(failure: StartFailure): string {
    switch (failure.kind) {
        case 'permission-denied':
            return 'PERMISSION_DENIED';
        case 'aborted':
            return 'CANCELLED';
        case 'timeout':
            return 'TIMEOUT';
        case 'config-error':
        case 'native-error':
            return errorCodeFromMessage(failure.message) ?? 'UNKNOWN';
    }
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * 共享的 stop-wait 核心：状态门控 → bridge.stop() → await STOPPED |
 * 超时 | reject(+宽限)。
 */
export function stopAndAwaitStopped(
    deps: { bridge: VpnBridge; log: VpnLogger; timers?: TimerHost },
    timeoutMs: number,
): Promise<StopResult> {
    const timers = deps.timers ?? defaultTimers;
    const { bridge, log } = deps;

    const status = bridge.getStatus();
    if (status !== VPN_STATUS.STARTED && status !== VPN_STATUS.STARTING) {
        return Promise.resolve({ outcome: 'already-stopped' });
    }

    return new Promise<StopResult>((resolve) => {
        let settled = false;
        let timer: TimerHandle | null = null;
        let removeListener: () => void = () => {};

        function settle(result: StopResult): void {
            if (settled) return;
            settled = true;
            if (timer !== null) timers.clearTimeout(timer);
            removeListener();
            resolve(result);
        }

        const sub = bridge.addStatusListener((s) => {
            if (s === VPN_STATUS.STOPPED) settle({ outcome: 'stopped' });
        });
        removeListener = () => sub.remove();

        timer = timers.setTimeout(() => settle({ outcome: 'timeout' }), timeoutMs);

        bridge.stop().catch((e: unknown) => {
            const message = errorMessage(e);
            log.warn(`[VPN] stop() rejected: ${message}`);
            timers.setTimeout(
                () => settle({ outcome: 'stop-rejected', message }),
                STOP_REJECT_GRACE_MS,
            );
        });
    });
}

export interface VpnActionDeps {
    bridge: VpnBridge;
    /** 由 vpn-context 注入的 Platform.OS（'android' 时才走权限流程）。 */
    platform: string;
    getProcessedConfig(): Promise<string>;
    nodeStore: NodeStore;
    log: VpnLogger;
    timers?: TimerHost;
}

export interface VpnActions {
    start(options?: StartOptions): Promise<StartResult>;
    stop(options?: StopOptions): Promise<StopResult>;
    selectNode(tag: string): Promise<SelectNodeResult>;
    triggerNodeTests(): void;
    resetNodes(): void;
}

export function createVpnActions(deps: VpnActionDeps): VpnActions {
    const timers = deps.timers ?? defaultTimers;
    const { bridge, platform, nodeStore, log } = deps;

    async function ensureVpnPermission(): Promise<boolean> {
        if (platform !== 'android') return true;
        if (await bridge.checkVpnPermission()) return true;
        return bridge.requestVpnPermission();
    }

    async function start(options?: StartOptions): Promise<StartResult> {
        const fail = (failure: StartFailure): StartResult => ({ ok: false, failure });
        if (options?.signal?.aborted) return fail({ kind: 'aborted' });

        // 权限 bridge 本身可能 reject（例如受限/锁定配置下 VpnService.prepare
        // 抛出 SecurityException）—— 将其映射为类型化失败，使 start() 绝不 reject。
        let permitted: boolean;
        try {
            permitted = await ensureVpnPermission();
        } catch (e) {
            return fail({ kind: 'native-error', message: errorMessage(e) });
        }
        if (!permitted) return fail({ kind: 'permission-denied' });
        if (options?.signal?.aborted) return fail({ kind: 'aborted' });

        let config: string;
        try {
            // Web 运行在 mock 模块上 —— 空配置让 smoke 路径可用。
            config = platform === 'web' ? '{}' : await deps.getProcessedConfig();
        } catch (e) {
            return fail({ kind: 'config-error', message: errorMessage(e) });
        }
        if (options?.signal?.aborted) return fail({ kind: 'aborted' });

        const timeoutMs = options?.timeoutMs;
        if (timeoutMs === undefined) {
            try {
                await bridge.start(config);
                return { ok: true };
            } catch (e) {
                return fail({ kind: 'native-error', message: errorMessage(e) });
            }
        }

        // 让原生 start 与挂钟计时赛跑。超时后原生 start 仍在后台继续运行。
        return new Promise<StartResult>((resolve) => {
            let settled = false;
            const timer = timers.setTimeout(() => {
                if (settled) return;
                settled = true;
                log.warn(`[VPN] start(): no result within ${timeoutMs}ms`);
                resolve(fail({ kind: 'timeout', timeoutMs }));
            }, timeoutMs);
            bridge.start(config).then(
                () => {
                    if (settled) return;
                    settled = true;
                    timers.clearTimeout(timer);
                    resolve({ ok: true });
                },
                (e: unknown) => {
                    if (settled) return;
                    settled = true;
                    timers.clearTimeout(timer);
                    resolve(fail({ kind: 'native-error', message: errorMessage(e) }));
                },
            );
        });
    }

    function stop(options?: StopOptions): Promise<StopResult> {
        return stopAndAwaitStopped(
            { bridge, log, timers },
            options?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
        );
    }

    async function selectNode(tag: string): Promise<SelectNodeResult> {
        try {
            // 错误通道因平台而异：iOS 失败时 reject，Android resolve `false`。
            // 尊重该布尔值，避免把失败的选择乐观地标记为当前节点（否则 Android
            // 上 UI 会报告一次并未发生的切换）。
            const ok = await bridge.selectProxyNode(tag);
            if (!ok) {
                return { ok: false, message: '' };
            }
            nodeStore.markCurrentNode(tag);
            return { ok: true };
        } catch (e) {
            return { ok: false, message: errorMessage(e) };
        }
    }

    function triggerNodeTests(): void {
        nodeStore.beginTestingWindow();
        // 一次性触发以立即出结果；后续测试由 sing-box 内部的 `interval`
        // 配置驱动。
        void bridge.triggerURLTest(GATEWAY_GROUP_TAG).catch(() => {});
        void bridge.triggerURLTest(AUTO_GROUP_TAG).catch(() => {});
    }

    function resetNodes(): void {
        nodeStore.reset();
    }

    return { start, stop, selectNode, triggerNodeTests, resetNodes };
}
