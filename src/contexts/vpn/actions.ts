/**
 * VpnContext action layer — pure core with injected dependencies.
 *
 * Ports the connect / disconnect / node flows previously duplicated in
 * use-home-screen.ts, config/index.tsx and use-proxy-nodes.ts into one
 * implementation. All failures surface as typed results (see types.ts);
 * nothing here throws across the boundary or presents UI.
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
/** Native stop() may still emit STOPPED after rejecting — grace window. */
const STOP_REJECT_GRACE_MS = 300;

/**
 * Map a start failure to the shared errorCode vocabulary for telemetry.
 * permission-denied / timeout / aborted map to fixed tokens; config-error and
 * native-error carry real native strings, classified via the fetch-policy
 * core. The single mapper for both the import flow and the home toggle — keep
 * their vpn_toggle / config_import failure codes in lockstep.
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
 * Shared stop-wait core: status gate → bridge.stop() → await STOPPED |
 * timeout | reject(+grace). The single implementation behind the
 * previous three copies (use-home-screen, config/index, vpn-restart).
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
    /** Platform.OS injected by vpn-context ('android' gates the permission flow). */
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

        // The permission bridge itself can reject (e.g. VpnService.prepare
        // throwing SecurityException under lockdown/restricted profiles) —
        // map that to a typed failure so start() never rejects.
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
            // Web runs against the mock module — an empty config keeps the
            // smoke path functional (previous use-home-screen behavior).
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

        // Race the native start against the wall clock. On timeout the
        // native start keeps running — parity with the previous
        // Promise.race in config/index.tsx.
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
            // Error channel diverges by platform: iOS rejects on failure, Android
            // resolves `false`. Honour the boolean so a failed selection never
            // gets optimistically marked as the current node (UI would otherwise
            // report a switch that never happened on Android).
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
        // One-shot trigger for immediate results; subsequent tests are
        // driven by sing-box's internal `interval` config.
        void bridge.triggerURLTest(GATEWAY_GROUP_TAG).catch(() => {});
        void bridge.triggerURLTest(AUTO_GROUP_TAG).catch(() => {});
    }

    function resetNodes(): void {
        nodeStore.reset();
    }

    return { start, stop, selectNode, triggerNodeTests, resetNodes };
}
