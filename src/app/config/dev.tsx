/**
 * Developer Tools — hidden page, accessible by tapping "About" section 3 times.
 * Shows background task status and subscription config state.
 */
import { lightImpact } from '@/components/ui/haptics';
import { CONFIG_REFRESH_TASK } from '@/tasks/config-refresh';
import { Fonts, Spacing } from '@/constants/theme';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import * as BackgroundTask from 'expo-background-task';
import { BackgroundTaskStatus } from 'expo-background-task';
import { router } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────

interface TaskInfo {
    isRegistered: boolean;
    taskStatus: BackgroundTaskStatus | null;
}

interface ConfigState {
    link: string | null;
    contentLength: number;
    usedTraffic: number;
    totalTraffic: number;
    expireTime: number;
}

// ─── Helpers ──────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function statusLabel(status: BackgroundTaskStatus | null): string {
    if (status === null) return 'Unknown';
    return status === BackgroundTaskStatus.Available ? 'Available' : 'Restricted';
}

function statusColor(status: BackgroundTaskStatus | null): string {
    return status === BackgroundTaskStatus.Available ? '#34C759' : '#FF9500';
}

// ─── Row ─────────────────────────────────────────────────────

function Row({
    label,
    value,
    valueColor,
    isLast,
    theme,
}: {
    label: string;
    value: string;
    valueColor?: string;
    isLast?: boolean;
    theme: ReturnType<typeof useTheme>;
}) {
    return (
        <View
            style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 11,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <Text style={{ fontSize: 14, color: theme.textSecondary }}>{label}</Text>
            <Text
                style={{
                    fontSize: 14,
                    fontWeight: '500',
                    color: valueColor ?? theme.text,
                    fontFamily: Fonts?.mono,
                    maxWidth: 220,
                }}
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}

function Card({ title, children, theme }: { title: string; children: React.ReactNode; theme: ReturnType<typeof useTheme> }) {
    return (
        <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 }}>
                {title}
            </Text>
            <View
                style={{
                    backgroundColor: theme.cardBackground,
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.border,
                }}
            >
                {children}
            </View>
        </View>
    );
}

// ─── Screen ──────────────────────────────────────────────────

export default function DevScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null);
    const [config, setConfig] = useState<ConfigState | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const [taskStatus, isRegistered] = await Promise.all([
            BackgroundTask.getStatusAsync().catch(() => null),
            TaskManager.isTaskRegisteredAsync(CONFIG_REFRESH_TASK).catch(() => false),
        ]);
        setTaskInfo({ isRegistered, taskStatus });
        setConfig({
            link: SBConfig.getConfigLink(),
            contentLength: SBConfig.getConfigContent().length,
            usedTraffic: SBConfig.getUsedTraffic(),
            totalTraffic: SBConfig.getTotalTraffic(),
            expireTime: SBConfig.getExpireTime(),
        });
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const expireDate = config && config.expireTime > 0
        ? new Date(config.expireTime * 1000).toLocaleString()
        : 'N/A';

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
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 16 }}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}
                >
                    <Ionicons name="chevron-back" size={20} color="#007AFF" />
                    <Text style={{ color: '#007AFF', fontSize: 16 }}>Back</Text>
                </Pressable>
                <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, fontFamily: Fonts?.rounded }}>
                    Developer
                </Text>
                <Pressable
                    onPress={() => { lightImpact(); load(); }}
                    style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.6 : 1 })}
                >
                    <Ionicons name="refresh" size={20} color="#007AFF" />
                </Pressable>
            </View>

            {loading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="large" color="#007AFF" />
                </View>
            ) : (
                <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
                    {/* Background Task */}
                    <Card title="Background Task" theme={theme}>
                        <Row
                            label="Task Name"
                            value={CONFIG_REFRESH_TASK}
                            theme={theme}
                        />
                        <Row
                            label="System Status"
                            value={statusLabel(taskInfo?.taskStatus ?? null)}
                            valueColor={statusColor(taskInfo?.taskStatus ?? null)}
                            theme={theme}
                        />
                        <Row
                            label="Registered"
                            value={taskInfo?.isRegistered ? 'Yes' : 'No'}
                            valueColor={taskInfo?.isRegistered ? '#34C759' : '#FF3B30'}
                            theme={theme}
                            isLast
                        />
                    </Card>

                    {/* Config State */}
                    <Card title="Subscription Config" theme={theme}>
                        <Row
                            label="Config URL"
                            value={config?.link ?? 'None'}
                            valueColor={config?.link ? theme.text : '#FF3B30'}
                            theme={theme}
                        />
                        <Row
                            label="Content Size"
                            value={config ? formatBytes(config.contentLength) : '—'}
                            theme={theme}
                        />
                        <Row
                            label="Used Traffic"
                            value={config ? formatBytes(config.usedTraffic) : '—'}
                            theme={theme}
                        />
                        <Row
                            label="Total Traffic"
                            value={config ? formatBytes(config.totalTraffic) : '—'}
                            theme={theme}
                        />
                        <Row
                            label="Expire Time"
                            value={expireDate}
                            theme={theme}
                            isLast
                        />
                    </Card>
                </ScrollView>
            )}
        </View>
    );
}
