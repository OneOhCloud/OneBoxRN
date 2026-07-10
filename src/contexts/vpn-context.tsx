import { StartupFailureModal, type StartupFailureInfo } from '@/components/ui/startup-failure-modal';
import i18n from '@/constants/language';
import { getProcessedConfig, refreshDirectDns } from '@/database/helper';
import { ProfileConfig } from '@/database/kv';
import { getStoreValue } from '@/database/store';
import { ConfigType } from '@/definition';
import { emitLog, getRecentLogs, jsLog } from '@/utils/log-sink';
import {
    describeConfigFingerprints,
    DIAGNOSTIC_LOG_COUNT,
    formatDiagnosticLogLine,
} from '@/utils/startup-diagnostics';
import { startupErrorTokenToKey } from '@/utils/startup-error-tokens';
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

// QA 开关：置为 true 可在 app/VPN 启动时展示启动失败 UI。
const FORCE_STARTUP_FAILURE = false;

// ─── Module-scope action singletons ─────────────────────────
//
// 在模块作用域创建一次（与 log-sink store 一样），使其身份在 provider
// 重挂载 / Fast Refresh 间保持稳定，且每个 JS runtime 只存在一个 restart
// machine。下面所有 ExpoOneBox 变更都经由它们 —— 其他层不得调用 bridge
// 的变更接口（docs/claude/vpn-context.md）。

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
    /** 需权限的连接；以类型化结果返回失败，绝不抛异常。 */
    start: (options?: StartOptions) => Promise<StartResult>;
    /** 可 await 的断开，在 STOPPED 事件时 resolve。 */
    stop: (options?: StopOptions) => Promise<StopResult>;
    /** 防抖、串行化的重启，使用最新配置。 */
    requestRestart: () => void;
    selectNode: (tag: string) => Promise<SelectNodeResult>;
    triggerNodeTests: () => void;
    resetNodes: () => void;
}

const VpnContext = createContext<VpnState | null>(null);

// ---- Provider ----

/**
 * 日志不由本 context 持有，而归 `log-sink.ts` 所有（基于
 * `useSyncExternalStore` 的环形缓冲，容量 1000）。此处的原生监听器经
 * `emitLog(...)` 写入 store；JS 辅助函数经 `jsLog.*` 写入；日志查看器经
 * `useLogs()` 监听。
 *
 * WHY：若把日志放进 context state，每条入站日志都会让所有 `useVpn()`
 * 消费方（home、settings、模式选择器）重渲染 —— 在 1000 行缓冲下无法接受。
 */
export function VpnProvider({ children }: { children: React.ReactNode }) {
    // 惰性初始化在首次渲染时读取原生真实状态（避免挂载期 setState）；
    // `connected` 是派生值，不单独存储。
    const [status, setStatus] = useState(() => ExpoOneBox.getStatus());
    const connected = status === VPN_STATUS.STARTED || status === VPN_STATUS.STARTING;
    const [traffic, setTraffic] = useState<TrafficUpdateEventPayload | null>(null);
    const [mode, setModeState] = useState<ConfigType>(() => ProfileConfig.getMode());
    const [directDns, setDirectDns] = useState<string>('—');
    const [startupFailure, setStartupFailure] = useState<StartupFailureInfo | null>(null);

    // 单飞：若已有刷新在途，所有调用方共享同一 promise，避免并发调用
    // getBestDns + KV 写入。
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

    // 挂载时从 KV 注水 directDns，让首帧显示缓存值而非 '—'。InfoCard 中的
    // useFocusEffect 随后会发起实时探测。
    useEffect(() => {
        getStoreValue('directDNS', '—')
            .then((v: string) => setDirectDns(v))
            .catch((e: unknown) => jsLog.warn('[VpnContext] KV hydration for directDNS failed:', e));
    }, []);

    const setMode = useCallback((m: ConfigType) => {
        setModeState(m);
        ProfileConfig.setMode(m);
        // 防抖 + 在途保护的重启。
        requestRestart();
    }, []);

    const presentStartupFailure = useCallback((info: Omit<StartupFailureInfo, 'occurredAt'>) => {
        // 面向用户的失败由原生发出语言无关的 token，此处映射到用户语言。
        // 非 token 的消息是原始二进制错误详情，原样展示。
        const raw = info.message?.trim();
        const tokenKey = startupErrorTokenToKey(raw);
        const message = tokenKey ? i18n.t(tokenKey) : (raw || i18n.t('startup_error_empty_message'));
        jsLog.warn('[VPN] Start failed:', message);
        emitLog({ source: 'native', level: 'error', message: `[StartFailed] ${message}` });
        // 失败时刻的诊断快照：最近日志 + 本次启动配置的指纹，随弹窗一起可复制
        // （见 startup-diagnostics.ts）。在 emitLog 之后采集，让 [StartFailed]
        // 行本身也进入快照。
        const recentLogs = getRecentLogs(DIAGNOSTIC_LOG_COUNT).map(formatDiagnosticLogLine);
        // merged = 实际下发原生的合并配置；profile = ProfileStore 存储的原始
        // 内容。分开列是为了回答“存储的配置字节是否变了”（merged 会随
        // directDNS 等环境值波动）。
        let configFingerprint: string | undefined;
        try {
            configFingerprint = describeConfigFingerprints({
                merged: ExpoOneBox.getStartConfig(),
                profile: ProfileConfig.getConfigContent(),
            }) ?? undefined;
        } catch (e) {
            jsLog.warn('[VPN] fingerprint for diagnostics failed:', e);
        }
        setStartupFailure({
            ...info,
            message,
            rawMessage: tokenKey ? raw : undefined,
            configFingerprint,
            recentLogs,
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
        // 把用户偏好的日志级别推入原生过滤器，使其在下一条 CommandServer
        // 日志时生效 —— 无需重启 tunnel。参见 Kotlin / Swift 模块中的
        // `setCoreLogLevel` 以及 vpn/core-log.ts 中的解析器注释。
        ExpoOneBox.setCoreLogLevel(ProfileConfig.getLogLevel());
        // 用零延迟 timer 重新同步 status，以消除 render→subscribe 竞态，
        // 又不在 effect 主体里同步 setState。
        const initialSyncTimer = setTimeout(syncStatus, 0);

        jsLog.info(`[App] VpnProvider ready, status=${ExpoOneBox.getStatus()}, mode=${ProfileConfig.getMode()}, logLevel=${ProfileConfig.getLogLevel()}`);

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
            // 级别过滤已在原生侧于此之前完成 —— 这里只解析前缀用于给行着色。
            const parsed = parseCoreLineLevel(event.message);
            emitLog({
                source: 'sing-box',
                level: parsed ? sbLevelToEntryLevel(parsed) : 'info',
                message: event.message,
            });
        });

        // 原生层日志管道 —— Kotlin / Swift 经此发出生命周期与操作事件。
        // 参见原生模块中的 `sendNativeLog`。
        const nativeLogSub = ExpoOneBox.addListener('onNativeLog', (event: { level: 'info' | 'warn' | 'error'; tag: string; message: string }) => {
            emitLog({
                source: 'native',
                level: event.level,
                message: `[${event.tag}] ${event.message}`,
            });
        });

        // group 更新经原生 CommandClient handler 从 libbox 的 group 流触发。
        // 这是全 app 唯一一处 onGroupUpdate 监听（docs/claude/vpn-context.md）：
        // 它喂给 node store（经 useProxyNodeState 读取），并为日志查看器产出
        // 一条原生来源的日志行。
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
