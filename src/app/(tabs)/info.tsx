/**
 * Info Screen — system info and traffic statistics.
 * All data sourced from the VpnContext shared state.
 */
import { ThemedText } from '@/components/themed-text';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { MaxContentWidth } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { getSingBoxUserAgent } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Platform, ScrollView, ToastAndroid, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GetVersion } from '../../modules/expo-onebox';

const MONO_FONT = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

// ─── Section Label ──────────────────────────────────────────
function SectionLabel({ text }: { text: string }) {
    return (
        <ThemedText
            type="small"
            themeColor="textSecondary"
            style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 4, marginBottom: 6 }}
        >
            {text}
        </ThemedText>
    );
}

// ─── Info Row ───────────────────────────────────────────────
function InfoRow({
    iconName,
    iconColor,
    label,
    children,
    isLast,
}: {
    iconName: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    label: string;
    children: React.ReactNode;
    isLast?: boolean;
}) {
    const theme = useTheme();
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 }}>
                <View
                    style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        backgroundColor: iconColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Ionicons name={iconName} size={16} color="#fff" />
                </View>
                <ThemedText style={{ flex: 1, fontSize: 15, fontWeight: '400' }}>{label}</ThemedText>
                {children}
            </View>
            {!isLast && (
                <View
                    style={{
                        height: 0.5,
                        backgroundColor: theme.textSecondary,
                        opacity: 0.15,
                        marginLeft: 42,
                    }}
                />
            )}
        </View>
    );
}

// ─── Info Card ──────────────────────────────────────────────
function InfoCard({ connected }: { connected: boolean }) {
    const theme = useTheme();
    const version = GetVersion();
    const ua = getSingBoxUserAgent();

    const handleCopyUA = () => {
        Clipboard.setStringAsync(ua);
        if (Platform.OS === 'android') {
            ToastAndroid.show('已复制', ToastAndroid.SHORT);
        }
    };

    return (
        <View>
            <SectionLabel text="系统信息" />
            <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 16, paddingHorizontal: 14 }}>
                {/* Kernel version */}
                <InfoRow iconName="cube-outline" iconColor="#5856D6" label="内核版本">
                    <ThemedText style={{ fontSize: 14, fontFamily: MONO_FONT, fontWeight: '500' }} themeColor="textSecondary">
                        {version || '—'}
                    </ThemedText>
                </InfoRow>

                {/* Run status */}
                <InfoRow iconName="radio-outline" iconColor={connected ? '#34C759' : '#8E8E93'} label="运行状态">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? '#34C759' : '#8E8E93' }} />
                        <ThemedText style={{ fontSize: 14, fontWeight: '500', color: connected ? '#34C759' : '#8E8E93' }}>
                            {connected ? '运行中' : '未连接'}
                        </ThemedText>
                    </View>
                </InfoRow>

                {/* User Agent */}
                <InfoRow iconName="finger-print-outline" iconColor="#FF9500" label="User Agent" isLast>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{ flexShrink: 1 }}
                            contentContainerStyle={{ alignItems: 'center' }}
                        >
                            <ThemedText style={{ fontSize: 12, fontFamily: MONO_FONT }} themeColor="textSecondary">
                                {ua}
                            </ThemedText>
                        </ScrollView>
                        <TouchableOpacity
                            onPress={handleCopyUA}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Ionicons name="copy-outline" size={14} color={theme.textSecondary} />
                        </TouchableOpacity>
                    </View>
                </InfoRow>
            </View>
        </View>
    );
}

// ─── Metric Cell ────────────────────────────────────────────
type MetricCellProps = {
    iconName: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    label: string;
    value: string;
};

function MetricCell({ iconName, iconColor, label, value }: MetricCellProps) {
    const theme = useTheme();
    return (
        <View
            style={{
                flex: 1,
                minWidth: '45%',
                backgroundColor: theme.background,
                borderRadius: 12,
                padding: 12,
                gap: 6,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name={iconName} size={13} color={iconColor} />
                <ThemedText style={{ fontSize: 11, fontWeight: '600', color: iconColor, letterSpacing: 0.2 }}>
                    {label}
                </ThemedText>
            </View>
            <ThemedText
                numberOfLines={1}
                style={{ fontSize: 18, fontWeight: '700', fontFamily: MONO_FONT, letterSpacing: -0.5 }}
            >
                {value}
            </ThemedText>
        </View>
    );
}

// ─── Traffic Card ───────────────────────────────────────────
function TrafficCard({ traffic }: { traffic: TrafficUpdateEventPayload | null }) {
    const theme = useTheme();

    function fmt(n: number) {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
        return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    const cells: MetricCellProps[] = traffic
        ? [
            { iconName: 'arrow-up-outline', iconColor: '#FF3B30', label: '上行速度', value: traffic.uplinkDisplay || fmt(traffic.uplink) + '/s' },
            { iconName: 'arrow-down-outline', iconColor: '#34C759', label: '下行速度', value: traffic.downlinkDisplay || fmt(traffic.downlink) + '/s' },
            { iconName: 'cloud-upload-outline', iconColor: '#FF6B35', label: '累计上行', value: traffic.uplinkTotalDisplay || fmt(traffic.uplinkTotal) },
            { iconName: 'cloud-download-outline', iconColor: '#30B0C7', label: '累计下行', value: traffic.downlinkTotalDisplay || fmt(traffic.downlinkTotal) },
            { iconName: 'hardware-chip-outline', iconColor: '#5856D6', label: '内存占用', value: traffic.memoryDisplay || fmt(traffic.memory) },
            { iconName: 'git-branch-outline', iconColor: '#AF52DE', label: 'Goroutines', value: String(traffic.goroutines) },
            { iconName: 'enter-outline', iconColor: '#007AFF', label: '入站连接', value: String(traffic.connectionsIn) },
            { iconName: 'exit-outline', iconColor: '#FF9500', label: '出站连接', value: String(traffic.connectionsOut) },
        ]
        : [];

    return (
        <View>
            <SectionLabel text="流量统计" />
            <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 16, padding: 14 }}>
                {traffic ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {cells.map((c) => (
                            <MetricCell key={c.label} {...c} />
                        ))}
                    </View>
                ) : (
                    <View style={{ paddingVertical: 28, alignItems: 'center', gap: 10 }}>
                        <Ionicons name="analytics-outline" size={32} color={theme.textSecondary} style={{ opacity: 0.4 }} />
                        <ThemedText type="small" themeColor="textSecondary" style={{ opacity: 0.7 }}>
                            加密隧道连接后显示实时统计
                        </ThemedText>
                    </View>
                )}
            </View>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// INFO Screen
// ─────────────────────────────────────────────────────────────

export default function InfoScreen() {
    const theme = useTheme();
    const { connected, traffic } = useVpn();

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, gap: 20, maxWidth: MaxContentWidth }}
                showsVerticalScrollIndicator={false}
            >
                {/* Page title */}
                <ThemedText type="subtitle">信息</ThemedText>

                {/* Routing mode */}
                <View>
                    <SectionLabel text="路由模式" />
                    <ModeSelector hideSectionLabel />
                </View>

                {/* System info */}
                <InfoCard connected={connected} />

                {/* Traffic stats */}
                <TrafficCard traffic={traffic} />
            </ScrollView>
        </SafeAreaView>
    );
}
