import { StartupFailureModal, type StartupFailureInfo } from '@/components/ui/startup-failure-modal';
import i18n from '@/constants/language';
import { refreshDirectDns } from '@/database/helper';
import { SBConfig, type SingBoxLogLevel } from '@/database/kv';
import { getStoreValue } from '@/database/store';
import { configType } from '@/definition';
import { emitLog, jsLog, type LogLevel } from '@/utils/log-sink';
import { requestVpnRestart } from '@/utils/vpn-restart';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import ExpoOneBox, { TrafficUpdateEventPayload, VPN_STATUS } from '../modules/expo-onebox';

// ─── sing-box core log-level parsing ────────────────────────
//
// Filtering by user's preferred level is done on the native side
// (`ExpoOneBox.setCoreLogLevel(...)` → Kotlin/Swift filter at the
// CommandClient handler, before entries cross into JS). Background:
// sing-box's `log.level` config only gates stdout and the observable
// sink — the platform writer feeding our CommandServer stream is
// unconditional (see `sing-box/log/observable.go:112-143` and
// `daemon/instance.go:109` in the vendored tree). Client-side
// filtering is the documented path.
//
// Here we keep only a small prefix parser so the Logs viewer can
// colour rows by level (error red, warn amber). The format is fixed
// by sing-box's `log/format.go:24`: `strings.ToUpper(FormatLevel(
// level))`, i.e. `TRACE[0000] …`, `INFO[0000] …`, etc. ANSI colour
// codes may wrap the level token because sing-box's platform
// formatter has `DisableColors: false`, so we strip them first.

const ANSI_STRIP_RE = /\x1b\[[0-9;]*m/g;
const LEVEL_PREFIX_RE = /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|PANIC)\b/i;

// QA switch: set to true to show the startup failure UI on app/VPN startup.
const FORCE_STARTUP_FAILURE = false;

function parseCoreLineLevel(message: string): SingBoxLogLevel | null {
    const stripped = message.replace(ANSI_STRIP_RE, '').trimStart();
    const m = stripped.match(LEVEL_PREFIX_RE);
    if (!m) return null;
    const token = m[1].toLowerCase();
    if (token === 'warning') return 'warn';
    return token as SingBoxLogLevel;
}

function sbLevelToEntryLevel(lv: SingBoxLogLevel): LogLevel {
    if (lv === 'error' || lv === 'fatal' || lv === 'panic') return 'error';
    if (lv === 'warn') return 'warn';
    return 'info';
}

// ---- Types ----

export interface VpnState {
    connected: boolean;
    status: number;
    traffic: TrafficUpdateEventPayload | null;
    mode: configType;
    setMode: (m: configType) => void;
    directDns: string;
    getStartConfig: () => string;
    refreshDirectDns: (fallback?: string) => Promise<string>;
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
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(0);
    const [traffic, setTraffic] = useState<TrafficUpdateEventPayload | null>(null);
    const [mode, setModeState] = useState<configType>(() => SBConfig.getMode());
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

    const setMode = useCallback((m: configType) => {
        setModeState(m);
        SBConfig.setMode(m);
        // Debounced + in-flight-guarded restart. See src/utils/vpn-restart.ts.
        requestVpnRestart();
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
        setConnected(s === VPN_STATUS.STARTED || s === VPN_STATUS.STARTING);
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
        // Kotlin / Swift modules and the parser comment in this file.
        ExpoOneBox.setCoreLogLevel(SBConfig.getLogLevel());
        syncStatus();

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

        const statusSub = ExpoOneBox.addListener('onStatusChange', (event: { status: number; statusName: string; message: string }) => {
            jsLog.info(`[VPN] Status changed: ${event.statusName}(${event.status}), isStartingUp=${isStartingUp.current}`);

            setStatus(event.status);
            setConnected(event.status === VPN_STATUS.STARTED || event.status === VPN_STATUS.STARTING);

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

        const errorSub = ExpoOneBox.addListener('onError', (event: { type: string; message: string; status?: number }) => {
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
        // CommandClient handler — surface them as native-origin lines so
        // the user can see node selection activity during normal run.
        const groupSub = ExpoOneBox.addListener('onGroupUpdate', (event: { all: { tag: string; delay: number }[]; now: string; autoNow?: string }) => {
            emitLog({
                source: 'native',
                level: 'info',
                message: `[Groups] now=${event.now}, autoNow=${event.autoNow ?? ''}, count=${event.all.length}`,
            });
        });

        // Background config refresh results — fire from the native task
        // (BGTaskScheduler / WorkManager). Log errors as error-level so
        // the red pill is visible on the row.
        const refreshSub = ExpoOneBox.addListener('onConfigRefreshResult', (event: { status: 'success' | 'failed' | 'skipped'; error?: string; durationMs: number; method?: string }) => {
            emitLog({
                source: 'native',
                level: event.status === 'failed' ? 'error' : 'info',
                message: `[ConfigRefresh] status=${event.status}${event.method ? `, method=${event.method}` : ''}, ${event.durationMs}ms${event.error ? `, error=${event.error}` : ''}`,
            });
        });

        const trafficSub = ExpoOneBox.addListener('onTrafficUpdate', (event: TrafficUpdateEventPayload) => {
            setTraffic(event);
        });

        return () => {
            if (startFailTimer) clearTimeout(startFailTimer);
            statusSub.remove();
            errorSub.remove();
            logSub.remove();
            nativeLogSub.remove();
            groupSub.remove();
            refreshSub.remove();
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
        <VpnContext.Provider value={{ connected, status, traffic, mode, setMode, directDns, getStartConfig, refreshDirectDns: refreshDirectDnsAction }}>
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
