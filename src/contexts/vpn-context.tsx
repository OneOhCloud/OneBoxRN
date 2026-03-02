import { SBConfig } from '@/database/kv';
import { configType } from '@/definition';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import {
    addErrorListener,
    addLogListener,
    addStatusChangeListener,
    addTrafficUpdateListener,
    GetStartError,
    GetStatus,
    SetCoreLogEnabled,
    TrafficUpdateEventPayload,
    VPN_STATUS,
} from '../modules/expo-onebox';

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
        console.log('Appending logs:', lines);
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
        const s = GetStatus();
        setStatus(s);
        setConnected(s === VPN_STATUS.STARTED || s === VPN_STATUS.STARTING);
        if (s === VPN_STATUS.STOPPED) setTraffic(null);
    }, []);

    useEffect(() => {
        SetCoreLogEnabled(true);
        syncStatus();

        // 跟踪上一个状态，用于检测 STARTING → STOPPED 这种启动失败场景
        const prevStatusRef = { current: GetStatus() };

        const statusSub = addStatusChangeListener((event: { status: number; statusName: string; message: string }) => {
            const prev = prevStatusRef.current;
            prevStatusRef.current = event.status;

            setStatus(event.status);
            setConnected(event.status === VPN_STATUS.STARTED || event.status === VPN_STATUS.STARTING);
            if (event.status === VPN_STATUS.STOPPED) {
                setTraffic(null);
                // 如果是从“正在连接”直接跳到“已停止”，说明启动失败，主动读取错误并弹窗
                if (prev === VPN_STATUS.STARTING) {
                    const errMsg = GetStartError();
                    console.warn('VPN failed to start. Start error message:', errMsg);
                    if (errMsg) {
                        appendLogs([`[StartFailed] ${errMsg}`]);
                        Alert.alert('VPN 启动失败', errMsg, [{ text: '确认' }]);
                    } else {
                        appendLogs(['[StartFailed] Extension exited during startup (no error message available)']);
                        Alert.alert('VPN 启动失败', '启动异常退出，请检查配置文件。', [{ text: '确认' }]);
                    }
                }
            }
        });

        const errorSub = addErrorListener((event: { type: string; message: string; status?: number }) => {
            // 错误事件统一写入日志。弹窗由上方 statusSub 检测文件方式触发，避免重复弹出。
            appendLogs([`[${event.type}] ${event.message}`]);
        });

        const logSub = addLogListener((event: { message: string }) => {
            appendLogs([event.message]);
        });

        const trafficSub = addTrafficUpdateListener((event: TrafficUpdateEventPayload) => {
            setTraffic(event);
        });

        return () => {
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
