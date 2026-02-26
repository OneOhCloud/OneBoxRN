import { SBConfig } from '@/database/kv';
import { configType } from '@/definition';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
    addErrorListener,
    addLogListener,
    addStatusChangeListener,
    addTrafficUpdateListener,
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

        const statusSub = addStatusChangeListener((event: { status: number; statusName: string; message: string }) => {
            setStatus(event.status);
            setConnected(event.status === VPN_STATUS.STARTED);
            if (event.status === VPN_STATUS.STOPPED) setTraffic(null);
        });

        const errorSub = addErrorListener((event: { type: string; message: string; status?: number }) => {
            appendLogs([`[ERROR][${event.type}] ${event.message}`]);
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
