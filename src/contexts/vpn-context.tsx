import { StartupFailureModal, type StartupFailureInfo } from '@/components/ui/startup-failure-modal';
import i18n from '@/constants/language';
import { getProcessedConfig, refreshDirectDns } from '@/database/helper';
import { SBConfig } from '@/database/kv';
import { getStoreValue } from '@/database/store';
import { ConfigType } from '@/definition';
import { emitLog, jsLog } from '@/utils/log-sink';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import ExpoOneBox, { ErrorEventPayload, GroupUpdateEventPayload, StatusChangeEventPayload, TrafficUpdateEventPayload, VPN_STATUS } from '@/modules/expo-onebox';
import { createVpnActions, stopAndAwaitStopped } from './vpn/actions';
import { expoOneBoxBridge } from './vpn/bridge';
import { parseCoreLineLevel, sbLevelToEntryLevel } from './vpn/core-log';
import { nodeStore } from './vpn/node-store';
import { createRestartMachine } from './vpn/restart-machine';
import type {
    SelectNodeResult,
    StartOptions,
    StartResult,
    StopOptions,
    StopResult,
} from './vpn/types';

// QA switch: set to true to show the startup failure UI on app/VPN startup.
const FORCE_STARTUP_FAILURE = false;

// ─── Module-scope action singletons ─────────────────────────
//
// Created once (module scope, like the log-sink store) so identities are
// stable across provider remounts / Fast Refresh and exactly one restart
// machine exists per JS runtime. All ExpoOneBox mutations below flow
// through these — no other layer may call the bridge mutation surface
// (docs/claude/vpn-context.md).

const vpnActions = createVpnActions({
    bridge: expoOneBoxBridge,
    platform: Platform.OS,
    getProcessedConfig,
    nodeStore,
    log: jsLog,
});

const restartMachine = createRestartMachine({
    getStatus: () => expoOneBoxBridge.getStatus(),
    stopAndWait: (timeoutMs) =>
        stopAndAwaitStopped({ bridge: expoOneBoxBridge, log: jsLog }, timeoutMs),
    start: (config) => expoOneBoxBridge.start(config),
    getConfig: getProcessedConfig,
    log: jsLog,
});

const requestRestart = (): void => restartMachine.request();

// ---- Types ----

export interface VpnState {
    connected: boolean;
    status: number;
    traffic: TrafficUpdateEventPayload | null;
    mode: ConfigType;
    setMode: (m: ConfigType) => void;
    directDns: string;
    getStartConfig: () => string;
    refreshDirectDns: (fallback?: string) => Promise<string>;
    /** Permission-gated connect; typed failures, never throws. */
    start: (options?: StartOptions) => Promise<StartResult>;
    /** Awaitable disconnect resolving on the STOPPED event. */
    stop: (options?: StopOptions) => Promise<StopResult>;
    /** Debounced, serialized restart with the freshest config. */
    requestRestart: () => void;
    selectNode: (tag: string) => Promise<SelectNodeResult>;
    triggerNodeTests: () => void;
    resetNodes: () => void;
}

const VpnContext = createContext<VpnState | null>(null);

// ---- Provider ----

/**
 * Logs no longer live in this context. They are owned by `log-sink.ts`
 * (a `useSyncExternalStore`-backed ring buffer, capacity 1000). Native
 * listeners here publish into the store via `emitLog(...)`; JS helpers
 * publish via `jsLog.*`; the Logs viewer subscribes via `useLogs()`.
 *
 * Rationale: keeping logs in context state caused every consumer of
 * `useVpn()` (home, settings, mode selector) to re-render on every
 * inbound log line — untenable at 1000-line buffers.
 */
export function VpnProvider({ children }: { children: React.ReactNode }) {
    // Lazy init reads native truth at first render (no mount-time
    // setState); `connected` is derived, not stored.
    const [status, setStatus] = useState(() => ExpoOneBox.getStatus());
    const connected = status === VPN_STATUS.STARTED || status === VPN_STATUS.STARTING;
    const [traffic, setTraffic] = useState<TrafficUpdateEventPayload | null>(null);
    const [mode, setModeState] = useState<ConfigType>(() => SBConfig.getMode());
    const [directDns, setDirectDns] = useState<string>('—');
    const [startupFailure, setStartupFailure] = useState<StartupFailureInfo | null>(null);

    // Single-flight: if a refresh is already in progress, all callers
    // share the same promise instead of racing to call getBestDns + KV-write.
    const directDnsInflightRef = useRef<Promise<string> | null>(null);

    const refreshDirectDnsAction = useCallback((fallback?: string): Promise<string> => {
        if (directDnsInflightRef.current) return directDnsInflightRef.current;
        const p = refreshDirectDns(fallback)
            .then((v) => {
                setDirectDns(v);
                return v;
            })
            .catch((e) => {
                jsLog.warn('[VpnContext] refreshDirectDns failed:', e);
                throw e;
            })
            .finally(() => {
                directDnsInflightRef.current = null;
            });
        directDnsInflightRef.current = p;
        return p;
    }, []);

    const getStartConfig = useCallback(() => ExpoOneBox.getStartConfig(), []);

    // Hydrate directDns from KV on mount so the first paint shows a cached
    // value rather than '—'. The useFocusEffect in InfoCard will follow up
    // with a live probe.
    useEffect(() => {
        getStoreValue('directDNS', '—')
            .then((v: string) => setDirectDns(v))
            .catch((e: unknown) => jsLog.warn('[VpnContext] KV hydration for directDNS failed:', e));
    }, []);

    const setMode = useCallback((m: ConfigType) => {
        setModeState(m);
        SBConfig.setMode(m);
        // Debounced + in-flight-guarded restart.
        requestRestart();
    }, []);

    const presentStartupFailure = useCallback((info: Omit<StartupFailureInfo, 'occurredAt'>) => {
        const message = info.message?.trim() || i18n.t('startup_error_empty_message');
        jsLog.warn('[VPN] Start failed:', message);
        emitLog({ source: 'native', level: 'error', message: `[StartFailed] ${message}` });
        setStartupFailure({
            ...info,
            message,
            occurredAt: new Date().toISOString(),
        });
    }, []);

    const syncStatus = useCallback(() => {
        const s = ExpoOneBox.getStatus();
        setStatus(s);
        if (s === VPN_STATUS.STOPPED) setTraffic(null);
    }, []);

    useEffect(() => {
        if (!FORCE_STARTUP_FAILURE) return;
        const timer = setTimeout(() => {
            presentStartupFailure({
                message: i18n.t('startup_forced_error_message'),
                source: 'debug_switch',
                type: 'ForcedStartupFailure',
                status: ExpoOneBox.getStatus(),
            });
        }, 0);
        return () => clearTimeout(timer);
    }, [presentStartupFailure]);

    useEffect(() => {
        ExpoOneBox.setCoreLogEnabled(true);
        // Push the user's log level preference into the native filter so
        // it takes effect on the next CommandServer log entry — without
        // needing to restart the tunnel. See `setCoreLogLevel` in the
        // Kotlin / Swift modules and the parser comment in vpn/core-log.ts.
        ExpoOneBox.setCoreLogLevel(SBConfig.getLogLevel());
        // Status was lazily initialized at first render; re-sync from a
        // zero-delay timer to close the render→subscribe race without a
        // synchronous setState in the effect body.
        const initialSyncTimer = setTimeout(syncStatus, 0);

        jsLog.info(`[App] VpnProvider ready, status=${ExpoOneBox.getStatus()}, mode=${SBConfig.getMode()}, logLevel=${SBConfig.getLogLevel()}`);

        // isStartingUp: JS 侧独立的启动标记。
        // 不依赖 prevStatus，因为 NEVPNStatus 可能走 connecting→disconnecting→disconnected，
        // 导致 prevStatus 在到达 STOPPED 时是 STOPPING(3) 而非 STARTING(1)。
        const isStartingUp = { current: false };
        const startFailAlertShown = { current: false };
        let startFailTimer: ReturnType<typeof setTimeout> | null = null;

        const showStartFailAlert = (info: Omit<StartupFailureInfo, 'occurredAt'>) => {
            if (startFailAlertShown.current) return;
            startFailAlertShown.current = true;
            presentStartupFailure(info);
        };

        const statusSub = ExpoOneBox.addListener('onStatusChange', (event: StatusChangeEventPayload) => {
            jsLog.info(`[VPN] Status changed: ${event.statusName}(${event.status}), isStartingUp=${isStartingUp.current}`);

            setStatus(event.status);

            if (event.status === VPN_STATUS.STARTING) {
                isStartingUp.current = true;
                startFailAlertShown.current = false;
                if (startFailTimer) { clearTimeout(startFailTimer); startFailTimer = null; }
                if (FORCE_STARTUP_FAILURE) {
                    showStartFailAlert({
                        message: i18n.t('startup_forced_error_message'),
                        source: 'debug_switch',
                        type: 'ForcedStartupFailure',
                        status: event.status,
                        statusName: event.statusName,
                    });
                }
            }

            if (event.status === VPN_STATUS.STARTED) {
                isStartingUp.current = false;
            }

            if (event.status === VPN_STATUS.STOPPED) {
                setTraffic(null);
                const wasStarting = isStartingUp.current;
                isStartingUp.current = false;
                jsLog.info(`[VPN] STOPPED received, wasStarting=${wasStarting}`);
                if (wasStarting) {
                    jsLog.info('[VPN] Detected startup failure, scheduling error file read...');
                    startFailTimer = setTimeout(() => {
                        startFailTimer = null;
                        if (startFailAlertShown.current) return;
                        const errMsg = ExpoOneBox.getStartError();
                        jsLog.info('[VPN] JS fallback: GetStartError() =', errMsg);
                        if (errMsg) {
                            showStartFailAlert({
                                message: errMsg,
                                source: 'startup_error_file',
                                status: event.status,
                                statusName: event.statusName,
                            });
                        } else {
                            showStartFailAlert({
                                message: i18n.t('startup_error_empty_message'),
                                source: 'fallback',
                                status: event.status,
                                statusName: event.statusName,
                            });
                        }
                    }, 800);
                }
            }
        });

        const errorSub = ExpoOneBox.addListener('onError', (event: ErrorEventPayload) => {
            emitLog({
                source: 'native',
                level: 'error',
                message: `[${event.type}] ${event.message}`,
            });
            if (event.type === 'StartServiceFailed') {
                jsLog.info('[VPN] Received StartServiceFailed from native:', event.message);
                if (startFailTimer) { clearTimeout(startFailTimer); startFailTimer = null; }
                showStartFailAlert({
                    message: event.message,
                    source: 'native_event',
                    type: event.type,
                    status: event.status ?? ExpoOneBox.getStatus(),
                });
            }
        });

        const logSub = ExpoOneBox.addListener('onLog', (event: { message: string }) => {
            // Level filtering is done natively before this fires —
            // we only parse the prefix here to colour the row.
            const parsed = parseCoreLineLevel(event.message);
            emitLog({
                source: 'sing-box',
                level: parsed ? sbLevelToEntryLevel(parsed) : 'info',
                message: event.message,
            });
        });

        // Native layer log pipe — Kotlin / Swift emit lifecycle & operation
        // events through here. See `sendNativeLog` in the native module.
        const nativeLogSub = ExpoOneBox.addListener('onNativeLog', (event: { level: 'info' | 'warn' | 'error'; tag: string; message: string }) => {
            emitLog({
                source: 'native',
                level: event.level,
                message: `[${event.tag}] ${event.message}`,
            });
        });

        // Group updates fire from libbox's group stream via the native
        // CommandClient handler. This is the single onGroupUpdate
        // subscription in the app (docs/claude/vpn-context.md): it feeds
        // the node store (read via useProxyNodeState) and surfaces a
        // native-origin log line for the Logs viewer.
        const groupSub = ExpoOneBox.addListener('onGroupUpdate', (event: GroupUpdateEventPayload) => {
            nodeStore.applyGroupUpdate(event);
            emitLog({
                source: 'native',
                level: 'info',
                message: `[Groups] now=${event.now}, autoNow=${event.autoNow ?? ''}, count=${event.all.length}`,
            });
        });

        const trafficSub = ExpoOneBox.addListener('onTrafficUpdate', (event: TrafficUpdateEventPayload) => {
            setTraffic(event);
        });

        return () => {
            clearTimeout(initialSyncTimer);
            if (startFailTimer) clearTimeout(startFailTimer);
            statusSub.remove();
            errorSub.remove();
            logSub.remove();
            nativeLogSub.remove();
            groupSub.remove();
            trafficSub.remove();
        };
    }, [presentStartupFailure, syncStatus]);

    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            if (appStateRef.current !== 'active' && nextState === 'active') {
                syncStatus();
            }
            appStateRef.current = nextState;
        });
        return () => sub.remove();
    }, [syncStatus]);

    return (
        <VpnContext.Provider
            value={{
                connected,
                status,
                traffic,
                mode,
                setMode,
                directDns,
                getStartConfig,
                refreshDirectDns: refreshDirectDnsAction,
                start: vpnActions.start,
                stop: vpnActions.stop,
                requestRestart,
                selectNode: vpnActions.selectNode,
                triggerNodeTests: vpnActions.triggerNodeTests,
                resetNodes: vpnActions.resetNodes,
            }}
        >
            {children}
            {startupFailure ? (
                <StartupFailureModal info={startupFailure} onClose={() => setStartupFailure(null)} />
            ) : null}
        </VpnContext.Provider>
    );
}

// ---- Hook ----

export function useVpn(): VpnState {
    const ctx = useContext(VpnContext);
    if (!ctx) throw new Error('useVpn must be used within VpnProvider');
    return ctx;
}
