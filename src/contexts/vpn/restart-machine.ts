/**
 * Serialized stop→start restart machine — pure core with injected deps.
 *
 * Verbatim port of the semantics of the former src/utils/vpn-restart.ts
 * (see that module's original rationale): a debounce window collapses
 * bursts of restart requests into one cycle, and an in-flight guard with
 * a `needsReRun` flag schedules exactly one follow-up when a request
 * arrives mid-cycle — so the tunnel never receives two concurrent starts
 * and always restarts with the user's final persisted choice.
 */

import { VPN_STATUS } from '../../modules/expo-onebox/src/ExpoOneBox.types.ts';
import type { StopResult, TimerHandle, TimerHost, VpnLogger } from './types.ts';
import { defaultTimers } from './types.ts';

export interface RestartMachineDeps {
    getStatus(): number;
    /** Shared stop-wait core (actions.ts stopAndAwaitStopped). */
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
     * Ask for a restart with the freshest config. Safe to call
     * repeatedly; no-op when the tunnel is not running (the caller's
     * own persisted write is enough — the next manual connect picks
     * up the new state).
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
        // Re-check status — user may have disconnected during the debounce.
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
                    // Give the freshly-started tunnel a moment to transition
                    // into STARTING before we immediately stop it again.
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
