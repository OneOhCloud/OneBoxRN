/**
 * 开发者工具 — 隐藏页，连点三次"关于"分区进入。
 * 展示后台任务状态、配置文件状态以及任务执行历史。
 * 视觉语言沿用 iOS 26 tab 屏（玻璃卡片、17pt 圆角行、hairline 分隔线）。
 */
import { BackgroundTaskCard } from '@/components/dev/background-task-card';
import { ConfigStateCard } from '@/components/dev/config-state-card';
import { DebugActionsCard } from '@/components/dev/debug-actions-card';
import { DevHeader } from '@/components/dev/dev-header';
import { ExecutionHistoryCard } from '@/components/dev/execution-history-card';
import { LastFailureCard } from '@/components/dev/last-failure-card';
import { LogLevelCard } from '@/components/dev/log-level-card';
import { PrimaryUrlTestCard } from '@/components/dev/primary-url-test-card';
import { TemplateCacheCard } from '@/components/dev/template-cache-card';
import { TlsTrustProbeCard } from '@/components/dev/tls-trust-probe-card';
import TrafficCard, { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { inspectConfigTemplateCache, type TemplateCacheInfo } from '@/database/config-template';
import type { TaskLogEntry } from '@/database/kv';
import { ProfileConfig, TaskLog } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import * as Task from '@/tasks/config-refresh';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface TaskInfo {
    isRegistered: boolean;
}

interface ConfigState {
    link: string | null;
    contentLength: number;
    usedTraffic: number;
    totalTraffic: number;
    expireTime: number;
}

export default function DevScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const { traffic } = useVpn();

    const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null);
    const [config, setConfig] = useState<ConfigState | null>(null);
    const [taskLog, setTaskLog] = useState<TaskLogEntry | null>(null);
    const [templateCache, setTemplateCache] = useState<TemplateCacheInfo[] | null>(null);
    const [loading, setLoading] = useState(true);

    // 纯读取、零 setState —— 可安全地从 mount effect 调用，
    // 不会触发 react-hooks/set-state-in-effect。
    const readDevSnapshot = useCallback(async () => {
        // 读取 KV 前先把后台任务结果同步进 JS 状态，
        // 使 WorkerRunLog 条目立即反映到 ExecutionHistory 中。
        Task.syncNativeResultToJS();
        const isRegistered = await ExpoOneBox.isBackgroundConfigRefreshRegistered().catch(() => false);
        const link = ProfileConfig.getConfigLink();
        return {
            taskInfo: { isRegistered },
            config: {
                link,
                contentLength: ProfileConfig.getConfigContent().length,
                usedTraffic: ProfileConfig.getUsedTraffic(),
                totalTraffic: ProfileConfig.getTotalTraffic(),
                expireTime: ProfileConfig.getExpireTime(),
            },
            taskLog: link ? TaskLog.get(link) : null,
            templateCache: await inspectConfigTemplateCache().catch(() => [] as TemplateCacheInfo[]),
        };
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        const s = await readDevSnapshot();
        setTaskInfo(s.taskInfo);
        setConfig(s.config);
        setTaskLog(s.taskLog);
        setTemplateCache(s.templateCache);
        setLoading(false);
    }, [readDevSnapshot]);

    useEffect(() => {
        let cancelled = false;
        // `loading` 初值为 true，因此 mount 路径只在完成时清除它。
        readDevSnapshot().then((s) => {
            if (cancelled) return;
            setTaskInfo(s.taskInfo);
            setConfig(s.config);
            setTaskLog(s.taskLog);
            setTemplateCache(s.templateCache);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [readDevSnapshot]);

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: theme.background,
                paddingTop: insets.top || Spacing.four,
                paddingBottom: insets.bottom + Spacing.three,
                paddingLeft: insets.left,
                paddingRight: insets.right,
            }}
        >
            <DevHeader onRefresh={load} />

            {loading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="large" color="#007AFF" />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={{
                        paddingHorizontal: Spacing.three,
                        paddingTop: Spacing.four,
                        paddingBottom: Spacing.six,
                        maxWidth: MaxContentWidth,
                        alignSelf: 'center',
                        width: '100%',
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={{ marginBottom: Spacing.four }}>
                        <SectionLabel text={i18n.t('traffic_stats')} />
                        <TrafficCard traffic={traffic} />
                    </View>

                    <LogLevelCard onChanged={load} />
                    <PrimaryUrlTestCard onSettingChanged={load} />
                    <TlsTrustProbeCard />
                    {taskInfo && <BackgroundTaskCard isRegistered={taskInfo.isRegistered} />}
                    <DebugActionsCard onExecuted={load} />
                    {config && (
                        <ConfigStateCard
                            link={config.link}
                            contentLength={config.contentLength}
                            usedTraffic={config.usedTraffic}
                            totalTraffic={config.totalTraffic}
                            expireTime={config.expireTime}
                        />
                    )}
                    <TemplateCacheCard info={templateCache} onChanged={load} />
                    <LastFailureCard />
                    <ExecutionHistoryCard taskLog={taskLog} />
                </ScrollView>
            )}
        </View>
    );
}
