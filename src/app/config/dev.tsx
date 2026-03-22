/**
 * Developer Tools — hidden page, accessible by tapping "About" section 3 times.
 * Shows background task status, subscription config state, and task execution history.
 */
import { lightImpact } from '@/components/ui/haptics';
import { CONFIG_REFRESH_TASK, executeConfigRefresh, registerConfigRefreshTask } from '@/tasks/config-refresh';
import { Fonts, Spacing } from '@/constants/theme';
import { SBConfig, TaskLog } from '@/database/kv';
import type { TaskLogEntry, TaskRecord, TaskStatus } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import * as BackgroundTask from 'expo-background-task';
import { BackgroundTaskStatus } from 'expo-background-task';
import { router } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

function sysStatusLabel(status: BackgroundTaskStatus | null): string {
    if (status === null) return 'Unknown';
    return status === BackgroundTaskStatus.Available ? 'Available' : 'Restricted';
}

function sysStatusColor(status: BackgroundTaskStatus | null): string {
    return status === BackgroundTaskStatus.Available ? '#34C759' : '#FF9500';
}

function taskStatusColor(status: TaskStatus): string {
    switch (status) {
        case 'success': return '#34C759';
        case 'skipped': return '#FF9500';
        case 'failed': return '#FF3B30';
    }
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
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

// ─── Task Record Row ─────────────────────────────────────────

function RecordRow({ record, isLast, theme }: { record: TaskRecord; isLast: boolean; theme: ReturnType<typeof useTheme> }) {
    const color = taskStatusColor(record.status);
    return (
        <View
            style={{
                paddingVertical: 10,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                    <Text style={{ fontSize: 13, color: theme.text, fontFamily: Fonts?.mono }}>
                        {formatTime(record.time)}
                    </Text>
                </View>
                <Text style={{ fontSize: 12, color: theme.textSecondary, fontFamily: Fonts?.mono }}>
                    {formatDuration(record.duration)}
                </Text>
            </View>
            {record.detail ? (
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2, marginLeft: 12 }} numberOfLines={1}>
                    {record.detail}
                </Text>
            ) : null}
        </View>
    );
}

// ─── Screen ──────────────────────────────────────────────────

export default function DevScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null);
    const [config, setConfig] = useState<ConfigState | null>(null);
    const [taskLog, setTaskLog] = useState<TaskLogEntry | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const [taskStatus, isRegistered] = await Promise.all([
            BackgroundTask.getStatusAsync().catch(() => null),
            TaskManager.isTaskRegisteredAsync(CONFIG_REFRESH_TASK).catch(() => false),
        ]);
        setTaskInfo({ isRegistered, taskStatus });

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

    const expireDate = config && config.expireTime > 0
        ? new Date(config.expireTime * 1000).toLocaleString()
        : 'N/A';

    // Reverse chronological for display
    const records = taskLog?.records ? [...taskLog.records].reverse() : [];

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
                            value={sysStatusLabel(taskInfo?.taskStatus ?? null)}
                            valueColor={sysStatusColor(taskInfo?.taskStatus ?? null)}
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

                    {/* Debug Actions */}
                    <Card title="Debug Actions" theme={theme}>
                        <Pressable
                            onPress={async () => {
                                lightImpact();
                                try {
                                    console.log('[Dev] executing config refresh directly...');
                                    const result = await executeConfigRefresh();
                                    console.log('[Dev] executeConfigRefresh result:', result);
                                    const label = result === 1 ? 'Success' : 'Failed';
                                    Alert.alert('Task Result', `${label}\nCheck logs for details.`);
                                    load();
                                } catch (e) {
                                    const msg = e instanceof Error ? e.message : String(e);
                                    console.warn('[Dev] trigger error:', e);
                                    Alert.alert('Trigger Error', msg);
                                }
                            }}
                            style={({ pressed }) => ({
                                paddingVertical: 12,
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: theme.border,
                                opacity: pressed ? 0.6 : 1,
                            })}
                        >
                            <Text style={{ fontSize: 14, color: '#007AFF', textAlign: 'center', fontWeight: '600' }}>
                                Run Task Now
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={async () => {
                                lightImpact();
                                try {
                                    // Unregister first, then re-register
                                    const isRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG_REFRESH_TASK);
                                    if (isRegistered) {
                                        console.log('[Dev] unregistering task first...');
                                        await BackgroundTask.unregisterTaskAsync(CONFIG_REFRESH_TASK);
                                    }
                                    console.log('[Dev] re-registering task...');
                                    await registerConfigRefreshTask();
                                    Alert.alert('Re-register', 'Task has been re-registered. Check logs.');
                                    load();
                                } catch (e) {
                                    const msg = e instanceof Error ? e.message : String(e);
                                    console.warn('[Dev] re-register error:', e);
                                    Alert.alert('Re-register Error', msg);
                                }
                            }}
                            style={({ pressed }) => ({
                                paddingVertical: 12,
                                opacity: pressed ? 0.6 : 1,
                            })}
                        >
                            <Text style={{ fontSize: 14, color: '#FF9500', textAlign: 'center', fontWeight: '600' }}>
                                Re-register Task
                            </Text>
                        </Pressable>
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

                    {/* Task Execution History */}
                    <Card title="Execution History" theme={theme}>
                        {taskLog ? (
                            <>
                                <Row
                                    label="Total Runs"
                                    value={String(taskLog.totalCount)}
                                    theme={theme}
                                />
                                <Row
                                    label="Last Run"
                                    value={taskLog.lastExecutedAt ? relativeTime(taskLog.lastExecutedAt) : 'Never'}
                                    valueColor={taskLog.lastExecutedAt ? theme.text : theme.textSecondary}
                                    theme={theme}
                                />
                                <Row
                                    label="Last Status"
                                    value={taskLog.lastStatus ?? '—'}
                                    valueColor={taskLog.lastStatus ? taskStatusColor(taskLog.lastStatus) : theme.textSecondary}
                                    theme={theme}
                                    isLast={records.length === 0}
                                />
                            </>
                        ) : (
                            <Row label="Status" value="No config URL" valueColor={theme.textSecondary} theme={theme} isLast />
                        )}
                    </Card>

                    {records.length > 0 && (
                        <Card title={`Recent Records (${records.length})`} theme={theme}>
                            {records.map((r, i) => (
                                <RecordRow
                                    key={r.time + i}
                                    record={r}
                                    isLast={i === records.length - 1}
                                    theme={theme}
                                />
                            ))}
                        </Card>
                    )}
                </ScrollView>
            )}
        </View>
    );
}
