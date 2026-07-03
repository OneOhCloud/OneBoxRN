/**
 * 串行化的 stop→start 重启状态机 —— 依赖注入的纯核心。
 *
 * 防抖窗口把突发的重启请求合并为一个周期；在途保护配合 `needsReRun`
 * 标志，在周期进行中到达请求时恰好安排一次后续 —— 使 tunnel 绝不收到两个
 * 并发的 start，且总以用户最终持久化的选择重启。
 */

import { VPN_STATUS } from '../../modules/expo-onebox/src/ExpoOneBox.types.ts';
import type { StopResult, TimerHandle, TimerHost, VpnLogger } from './types.ts';
import { defaultTimers } from './types.ts';

export interface RestartMachineDeps {
    getStatus(): number;
    /** 共享的 stop-wait 核心（actions.ts 的 stopAndAwaitStopped）。 */
    stopAndWait(timeoutMs: number): Promise<StopResult>;
    start(config: string): Promise<void>;
    getConfig(): Promise<string>;
    log: VpnLogger;
    timers?: TimerHost;
}

export interface RestartMachineOptions {
    debounceMs?: number;
    stopTimeoutMs?: number;
    rearmDelayMs?: number;
}

export interface RestartMachine {
    /**
     * 以最新配置请求一次重启。可重复调用；tunnel 未运行时为 no-op
     *（调用方自身的持久化写入已足够 —— 下次手动连接会读到新状态）。
     */
    request(): void;
}

export function createRestartMachine(
    deps: RestartMachineDeps,
    options?: RestartMachineOptions,
): RestartMachine {
    const timers = deps.timers ?? defaultTimers;
    const debounceMs = options?.debounceMs ?? 250;
    const stopTimeoutMs = options?.stopTimeoutMs ?? 10_000;
    const rearmDelayMs = options?.rearmDelayMs ?? 400;

    let debounceTimer: TimerHandle | null = null;
    let inFlight = false;
    let needsReRun = false;

    function isRunning(): boolean {
        const status = deps.getStatus();
        return status === VPN_STATUS.STARTED || status === VPN_STATUS.STARTING;
    }

    function runCycle(): void {
        // 重新检查状态 —— 用户可能在防抖期间已断开。
        if (!isRunning()) return;

        inFlight = true;
        needsReRun = false;

        void deps
            .stopAndWait(stopTimeoutMs)
            .then((stopResult) => {
                if (stopResult.outcome === 'timeout') {
                    deps.log.warn('[VPN] Restart: stop timeout, restarting anyway');
                }
                return deps.getConfig().then((config) => deps.start(config));
            })
            .catch((e: unknown) => {
                deps.log.warn(`[VPN] Restart failed: ${e instanceof Error ? e.message : String(e)}`);
            })
            .finally(() => {
                inFlight = false;
                if (needsReRun) {
                    needsReRun = false;
                    // 给刚启动的 tunnel 一点时间进入 STARTING，再立即停止它。
                    timers.setTimeout(runCycle, rearmDelayMs);
                }
            });
    }

    return {
        request(): void {
            if (!isRunning()) return;

            if (inFlight) {
                needsReRun = true;
                return;
            }

            if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
            debounceTimer = timers.setTimeout(() => {
                debounceTimer = null;
                runCycle();
            }, debounceMs);
        },
    };
}
