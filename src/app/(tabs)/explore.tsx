/**
 * Monitor Screen — system info, traffic statistics, and runtime logs.
 * All data sourced from the VpnContext shared state.
 */
import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GetVersion } from '../../modules/expo-onebox';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── Info Card ──────────────────────────────────────────────
/** System information: kernel version and run status */
function InfoCard({ connected }: { connected: boolean }) {
    const theme = useTheme();
    const version = GetVersion();

    return (
        <View className="rounded-2xl p-4 gap-3" style={{ backgroundColor: theme.backgroundElement }}>
            <ThemedText className="text-sm font-semibold mb-1" themeColor="textSecondary">
                系统信息
            </ThemedText>
            {/* Kernel version */}
            <View className="flex-row justify-between items-center">
                <ThemedText type="small" themeColor="textSecondary">内核版本</ThemedText>
                <ThemedText type="small" className="font-medium" style={{ fontFamily: MONO_FONT }}>
                    {version || '—'}
                </ThemedText>
            </View>
            {/* Separator — using whitespace instead of line for iOS feel */}
            <View className="h-px" style={{ backgroundColor: theme.background, opacity: 0.6 }} />
            {/* Run status */}
            <View className="flex-row justify-between items-center">
                <ThemedText type="small" themeColor="textSecondary">运行状态</ThemedText>
                <View className="flex-row items-center gap-1.5">
                    <View
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: connected ? '#34C759' : '#8E8E93' }}
                    />
                    <ThemedText
                        type="small"
                        className="font-semibold"
                        style={{ color: connected ? '#34C759' : '#8E8E93' }}
                    >
                        {connected ? '运行中' : '未连接'}
                    </ThemedText>
                </View>
            </View>
        </View>
    );
}

// ─── Metric Cell ────────────────────────────────────────────
/** Single traffic metric display */
function MetricCell({ icon, label, value }: { icon: string; label: string; value: string }) {
    const theme = useTheme();
    return (
        <View
            className="flex-1 rounded-xl p-3 gap-1"
            style={{ minWidth: '45%', backgroundColor: theme.background }}
        >
            <ThemedText className="text-sm font-semibold" style={{ color: '#007AFF' }}>
                {icon}
            </ThemedText>
            <ThemedText
                numberOfLines={1}
                className="text-sm font-bold"
                style={{ fontFamily: MONO_FONT }}
            >
                {value}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" className="text-xs">
                {label}
            </ThemedText>
        </View>
    );
}

// ─── Traffic Card ───────────────────────────────────────────
/** Grid of 8 traffic/system metrics */
function TrafficCard({ traffic }: { traffic: TrafficUpdateEventPayload | null }) {
    const theme = useTheme();

    function fmt(n: number) {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
        return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    const cells: { icon: string; label: string; value: string }[] = traffic
        ? [
            { icon: '↑', label: '上行速度', value: traffic.uplinkDisplay || fmt(traffic.uplink) + '/s' },
            { icon: '↓', label: '下行速度', value: traffic.downlinkDisplay || fmt(traffic.downlink) + '/s' },
            { icon: '▲', label: '累计上行', value: traffic.uplinkTotalDisplay || fmt(traffic.uplinkTotal) },
            { icon: '▼', label: '累计下行', value: traffic.downlinkTotalDisplay || fmt(traffic.downlinkTotal) },
            { icon: '◎', label: '内存占用', value: traffic.memoryDisplay || fmt(traffic.memory) },
            { icon: '⟳', label: 'Goroutines', value: String(traffic.goroutines) },
            { icon: '→', label: '入站连接', value: String(traffic.connectionsIn) },
            { icon: '←', label: '出站连接', value: String(traffic.connectionsOut) },
        ]
        : [];

    return (
        <View className="rounded-2xl p-4 gap-3" style={{ backgroundColor: theme.backgroundElement }}>
            <ThemedText className="text-sm font-semibold" themeColor="textSecondary">
                流量统计
            </ThemedText>
            {traffic ? (
                <View className="flex-row flex-wrap gap-2">
                    {cells.map((c) => (
                        <MetricCell key={c.label} icon={c.icon} label={c.label} value={c.value} />
                    ))}
                </View>
            ) : (
                <View className="py-4 items-center">
                    <ThemedText type="small" themeColor="textSecondary">
                        代理连接后显示实时统计
                    </ThemedText>
                </View>
            )}
        </View>
    );
}

// ─── Log Panel ──────────────────────────────────────────────
/** Scrollable log viewer with clear action */
function LogPanel({ logs, onClear }: { logs: string[]; onClear: () => void }) {
    const theme = useTheme();
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        if (logs.length > 0) {
            scrollRef.current?.scrollToEnd({ animated: true });
        }
    }, [logs]);

    return (
        <View className="rounded-2xl p-4 gap-3" style={{ backgroundColor: theme.backgroundElement }}>
            {/* Header with clear action */}
            <View className="flex-row justify-between items-center">
                <ThemedText className="text-sm font-semibold" themeColor="textSecondary">
                    运行日志
                </ThemedText>
                {logs.length > 0 && (
                    <Pressable
                        onPress={() => { lightImpact(); onClear(); }}
                        className="px-3 py-1.5 rounded-lg active:opacity-70"
                        style={{ backgroundColor: '#007AFF' }}
                    >
                        <ThemedText style={{ color: '#ffffff' }} className="text-xs font-medium">
                            清除
                        </ThemedText>
                    </Pressable>
                )}
            </View>
            {/* Log content */}
            <View className="h-72 rounded-xl overflow-hidden" style={{ backgroundColor: theme.background }}>
                <ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    contentContainerStyle={{ padding: 10 }}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                >
                    {logs.length === 0 ? (
                        <View className="py-10 items-center">
                            <ThemedText type="small" themeColor="textSecondary">暂无日志</ThemedText>
                        </View>
                    ) : (
                        logs.map((line, i) => (
                            <ThemedText
                                key={`log-${i}`}
                                type="small"
                                themeColor={line.includes('[ERROR]') ? undefined : 'textSecondary'}
                                className="text-xs leading-4"
                                style={{
                                    fontFamily: MONO_FONT,
                                    ...(line.includes('[ERROR]') && { color: '#FF3B30' }),
                                }}
                            >
                                {line}
                            </ThemedText>
                        ))
                    )}
                </ScrollView>
            </View>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// Monitor Screen
// ─────────────────────────────────────────────────────────────

export default function MonitorScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const { connected, traffic, logs, clearLogs } = useVpn();

    const insets = {
        ...safeAreaInsets,
        bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    };

    const contentPlatformStyle = Platform.select({
        android: {
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
        },
        web: {
            paddingTop: Spacing.six,
            paddingBottom: Spacing.four,
        },
    });

    return (
        <ScrollView
            className="flex-1"
            style={{ backgroundColor: theme.background }}
            contentInset={insets}
            contentContainerStyle={{
                flexDirection: 'row',
                justifyContent: 'center',
                ...contentPlatformStyle,
            }}
        >
            <View className="grow px-5 pt-6 gap-4" style={{ maxWidth: MaxContentWidth }}>
                {/* Page title */}
                <ThemedText type="subtitle" className="mb-1">监控</ThemedText>

                {/* Info card */}
                <InfoCard connected={connected} />

                {/* Traffic stats */}
                <TrafficCard traffic={traffic} />

                {/* Log viewer */}
                <LogPanel logs={logs} onClear={clearLogs} />
            </View>
        </ScrollView>
    );
}
