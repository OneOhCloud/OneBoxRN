/**
 * Developer Tools — hidden page, accessible by tapping "About" section 3 times.
 * Shows background task status, profile config state, and task execution history.
 */
import { AccelerateUrlSettingCard } from '@/components/dev/accelerate-url-setting-card';
import { BackgroundTaskCard } from '@/components/dev/background-task-card';
import { ConfigStateCard } from '@/components/dev/config-state-card';
import { DebugActionsCard } from '@/components/dev/debug-actions-card';
import { DevHeader } from '@/components/dev/dev-header';
import { ExecutionHistoryCard } from '@/components/dev/execution-history-card';
import { PrimaryUrlTestCard } from '@/components/dev/primary-url-test-card';
import { Spacing } from '@/constants/theme';
import type { TaskLogEntry } from '@/database/kv';
import { SBConfig, TaskLog } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
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

    const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null);
    const [config, setConfig] = useState<ConfigState | null>(null);
    const [taskLog, setTaskLog] = useState<TaskLogEntry | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const isRegistered = await ExpoOneBox.isBackgroundConfigRefreshRegistered().catch(() => false);
        setTaskInfo({ isRegistered });

        const link = SBConfig.getConfigLink();
        setConfig({
            link,
            contentLength: SBConfig.getConfigContent().length,
            usedTraffic: SBConfig.getUsedTraffic(),
            totalTraffic: SBConfig.getTotalTraffic(),
            expireTime: SBConfig.getExpireTime(),
        });

        if (link) {
            setTaskLog(TaskLog.get(link));
        } else {
            setTaskLog(null);
        }

        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: theme.background,
                paddingTop: insets.top || Spacing.six,
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
                <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
                    <AccelerateUrlSettingCard onSettingChanged={load} />
                    <PrimaryUrlTestCard onSettingChanged={load} />
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
                    <ExecutionHistoryCard taskLog={taskLog} />
                </ScrollView>
            )}
        </View>
    );
}
