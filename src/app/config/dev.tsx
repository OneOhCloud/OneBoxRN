/**
 * Developer Tools — hidden page, accessible by tapping "About" section 3 times.
 * Shows background task status, profile config state, and task execution history.
 * Visual language mirrors the iOS 26 tab screens (glass cards, 17pt rounded rows,
 * hairline separators).
 */
import { BackgroundTaskCard } from '@/components/dev/background-task-card';
import { ConfigStateCard } from '@/components/dev/config-state-card';
import { DebugActionsCard } from '@/components/dev/debug-actions-card';
import { DevHeader } from '@/components/dev/dev-header';
import { ExecutionHistoryCard } from '@/components/dev/execution-history-card';
import { LogLevelCard } from '@/components/dev/log-level-card';
import { PrimaryUrlTestCard } from '@/components/dev/primary-url-test-card';
import { TemplateCacheCard } from '@/components/dev/template-cache-card';
import TrafficCard, { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { inspectConfigTemplateCache, type TemplateCacheInfo } from '@/database/helper';
import type { TaskLogEntry } from '@/database/kv';
import { SBConfig, TaskLog } from '@/database/kv';
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

    // Pure reads, zero setState — safe to invoke from the mount effect
    // without tripping react-hooks/set-state-in-effect.
    const readDevSnapshot = useCallback(async () => {
        // Sync any background task results into JS state before reading KV,
        // so WorkerRunLog entries are immediately reflected in ExecutionHistory.
        Task.syncNativeResultToJS();
        const isRegistered = await ExpoOneBox.isBackgroundConfigRefreshRegistered().catch(() => false);
        const link = SBConfig.getConfigLink();
        return {
            taskInfo: { isRegistered },
            config: {
                link,
                contentLength: SBConfig.getConfigContent().length,
                usedTraffic: SBConfig.getUsedTraffic(),
                totalTraffic: SBConfig.getTotalTraffic(),
                expireTime: SBConfig.getExpireTime(),
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
        // `loading` starts true, so the mount path only clears it when done.
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

                    <LogLevelCard onChanged={load} index={1} />
                    <PrimaryUrlTestCard onSettingChanged={load} index={2} />
                    {taskInfo && <BackgroundTaskCard isRegistered={taskInfo.isRegistered} index={3} />}
                    <DebugActionsCard onExecuted={load} index={4} />
                    {config && (
                        <ConfigStateCard
                            link={config.link}
                            contentLength={config.contentLength}
                            usedTraffic={config.usedTraffic}
                            totalTraffic={config.totalTraffic}
                            expireTime={config.expireTime}
                            index={5}
                        />
                    )}
                    <TemplateCacheCard info={templateCache} onChanged={load} index={6} />
                    <ExecutionHistoryCard taskLog={taskLog} index={7} />
                </ScrollView>
            )}
        </View>
    );
}
