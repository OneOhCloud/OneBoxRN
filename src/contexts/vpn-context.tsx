import i18n from '@/constants/language';
import { SBConfig } from '@/database/kv';
import { configType } from '@/definition';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import ExpoOneBox, { TrafficUpdateEventPayload, VPN_STATUS } from '../modules/expo-onebox';

// ---- Types ----

export interface VpnState {
    connected: boolean;
    status: number;
    traffic: TrafficUpdateEventPayload | null;
    logs: string[];
    mode: configType;
    setMode: (m: configType) => void;
    clearLogs: () => void;
}

const VpnContext = createContext<VpnState | null>(null);

const MAX_LOG_LINES = 200;

// ---- Provider ----

export function VpnProvider({ children }: { children: React.ReactNode }) {
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(0);
    const [traffic, setTraffic] = useState<TrafficUpdateEventPayload | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [mode, setModeState] = useState<configType>(() => SBConfig.getMode());

    const appendLogs = useCallback((lines: string[]) => {
        console.log('[sing-box]:', lines);
        setLogs((prev) => {
            const next = [...prev, ...lines];
            return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
        });
    }, []);

    const clearLogs = useCallback(() => setLogs([]), []);

    const setMode = useCallback((m: configType) => {
        setModeState(m);
        SBConfig.setMode(m);
    }, []);

    const syncStatus = useCallback(() => {
        const s = ExpoOneBox.getStatus();
        setStatus(s);
        setConnected(s === VPN_STATUS.STARTED || s === VPN_STATUS.STARTING);
        if (s === VPN_STATUS.STOPPED) setTraffic(null);
    }, []);

    useEffect(() => {
        ExpoOneBox.setCoreLogEnabled(true);
        syncStatus();

        // isStartingUp: JS 侧独立的启动标记。
        // 不依赖 prevStatus，因为 NEVPNStatus 可能走 connecting→disconnecting→disconnected，
        // 导致 prevStatus 在到达 STOPPED 时是 STOPPING(3) 而非 STARTING(1)。
        const isStartingUp = { current: false };
        const startFailAlertShown = { current: false };
        let startFailTimer: ReturnType<typeof setTimeout> | null = null;

        // 显示启动失败弹窗的统一方法（带去重）
        const showStartFailAlert = (errMsg: string) => {
            if (startFailAlertShown.current) return;
            startFailAlertShown.current = true;
            console.warn('[VPN] Start failed:', errMsg);
            appendLogs([`[StartFailed] ${errMsg}`]);
            Alert.alert(i18n.t('vpn_start_failed'), errMsg, [{ text: i18n.t('confirm') }]);
        };

        const statusSub = ExpoOneBox.addListener('onStatusChange', (event: { status: number; statusName: string; message: string }) => {
            console.log(`[VPN] Status changed: ${event.statusName}(${event.status}), isStartingUp=${isStartingUp.current}`);

            setStatus(event.status);
            setConnected(event.status === VPN_STATUS.STARTED || event.status === VPN_STATUS.STARTING);

            if (event.status === VPN_STATUS.STARTING) {
                isStartingUp.current = true;
                startFailAlertShown.current = false;
                if (startFailTimer) { clearTimeout(startFailTimer); startFailTimer = null; }
            }

            if (event.status === VPN_STATUS.STARTED) {
                isStartingUp.current = false;
            }

            if (event.status === VPN_STATUS.STOPPED) {
                setTraffic(null);
                const wasStarting = isStartingUp.current;
                isStartingUp.current = false;
                console.log(`[VPN] STOPPED received, wasStarting=${wasStarting}`);
                // 后备机制：JS 侧检测启动中→停止，延迟读文件兜底
                if (wasStarting) {
                    console.log('[VPN] Detected startup failure, scheduling error file read...');
                    startFailTimer = setTimeout(() => {
                        startFailTimer = null;
                        if (startFailAlertShown.current) return; // 原生事件已经弹过了
                        const errMsg = ExpoOneBox.getStartError();
                        console.log('[VPN] JS fallback: GetStartError() =', errMsg);
                        if (errMsg) {
                            showStartFailAlert(errMsg);
                        } else {
                            showStartFailAlert(i18n.t('startup_abnormal_exit'));
                        }
                    }, 800); // 给原生侧 500ms 先尝试推送，再等 300ms 兜底
                }
            }
        });

        const errorSub = ExpoOneBox.addListener('onError', (event: { type: string; message: string; status?: number }) => {
            appendLogs([`[${event.type}] ${event.message}`]);
            // 原生层检测到启动失败后会推送 StartServiceFailed 错误事件
            if (event.type === 'StartServiceFailed') {
                console.log('[VPN] Received StartServiceFailed from native:', event.message);
                if (startFailTimer) { clearTimeout(startFailTimer); startFailTimer = null; }
                showStartFailAlert(event.message);
            }
        });

        const logSub = ExpoOneBox.addListener('onLog', (event: { message: string }) => {
            appendLogs([event.message]);
        });

        const trafficSub = ExpoOneBox.addListener('onTrafficUpdate', (event: TrafficUpdateEventPayload) => {
            setTraffic(event);
        });

        return () => {
            if (startFailTimer) clearTimeout(startFailTimer);
            statusSub.remove();
            errorSub.remove();
            logSub.remove();
            trafficSub.remove();
        };
    }, [syncStatus, appendLogs]);

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
        <VpnContext.Provider value={{ connected, status, traffic, logs, mode, setMode, clearLogs }}>
            {children}
        </VpnContext.Provider>
    );
}

// ---- Hook ----

export function useVpn(): VpnState {
    const ctx = useContext(VpnContext);
    if (!ctx) throw new Error('useVpn must be used within VpnProvider');
    return ctx;
}
