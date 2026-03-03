/**
 * Monitor Screen — system info and traffic statistics.
 * All data sourced from the VpnContext shared state.
 */
import { ThemedText } from '@/components/themed-text';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { MaxContentWidth } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
            {/* ── Mode selector ─────────────────────────── */}

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

// ─────────────────────────────────────────────────────────────
// Monitor Screen
// ─────────────────────────────────────────────────────────────

export default function MonitorScreen() {
    const theme = useTheme();
    const { connected, traffic } = useVpn();





    return (
        <SafeAreaView
            style={{ flex: 1, backgroundColor: theme.background }}
        >
            <View className="flex-1 px-5 pt-6 gap-4" style={{ maxWidth: MaxContentWidth }}>
                {/* Page title */}
                <ThemedText type="subtitle" className="mb-1">监控</ThemedText>
                <View className='py-2'>
                    <ModeSelector />
                </View>
                {/* Info card */}
                <InfoCard connected={connected} />

                {/* Traffic stats */}
                <TrafficCard traffic={traffic} />
            </View>
        </SafeAreaView>
    );
}
