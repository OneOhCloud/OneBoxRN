import { ThemedText } from '@/components/themed-text';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox';
import { formatBytes } from '@/utils/format-bytes';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Text, View } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

export function SectionLabel({ text }: { text: string }) {
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

// ─── Metric Cell ────────────────────────────────────────────
type MetricCellProps = {
    iconName: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    label: string;
    value: string;
};

function MetricCell({ iconName, iconColor, label, value }: MetricCellProps) {
    return (
        <View style={{ width: '48%', flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: iconColor, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={iconName} size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
                <ThemedText numberOfLines={1} style={{ fontSize: 11, fontWeight: '400', marginBottom: 2 }} themeColor="textSecondary">
                    {label}
                </ThemedText>
                <ThemedText numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', fontFamily: MONO_FONT, letterSpacing: -0.3 }}>
                    {value}
                </ThemedText>
            </View>
        </View>
    );
}

// ─── Traffic Card ───────────────────────────────────────────
/** Traffic metric grid with its own backgroundElement card shell. */
export default function TrafficCard({ traffic }: { traffic: TrafficUpdateEventPayload | null }) {
    const theme = useTheme();

    // Format from the raw byte counts with the shared formatter rather than the
    // native *Display strings, which diverge (Android Libbox.formatBytes is
    // SI/1000-based, iOS LibboxFormatMemoryBytes is binary/1024-based) — audit C10.
    const cells: MetricCellProps[] = traffic ? [
        { iconName: 'arrow-up-outline', iconColor: '#007AFF', label: i18n.t('uplink_speed'), value: formatBytes(traffic.uplink) + '/s' },
        { iconName: 'arrow-down-outline', iconColor: '#32ADE6', label: i18n.t('downlink_speed'), value: formatBytes(traffic.downlink) + '/s' },
        { iconName: 'cloud-upload-outline', iconColor: '#3A82F7', label: i18n.t('uplink_total'), value: formatBytes(traffic.uplinkTotal) },
        { iconName: 'cloud-download-outline', iconColor: '#5AC8FA', label: i18n.t('downlink_total'), value: formatBytes(traffic.downlinkTotal) },
        { iconName: 'hardware-chip-outline', iconColor: '#5856D6', label: i18n.t('memory_usage'), value: formatBytes(traffic.memory) },
        { iconName: 'git-branch-outline', iconColor: '#7B61FF', label: i18n.t('active_tasks'), value: String(traffic.goroutines) },
        { iconName: 'enter-outline', iconColor: '#4A90D9', label: i18n.t('inbound_connections'), value: String(traffic.connectionsIn) },
        { iconName: 'exit-outline', iconColor: '#6E8FC9', label: i18n.t('outbound_connections'), value: String(traffic.connectionsOut) },
    ] : [];

    return (
        <View style={{ backgroundColor: theme.glassBackground, borderRadius: 20, borderWidth: 0.5, borderColor: theme.glassBorder, paddingVertical: 6 }}>
            {traffic ? (
                <View style={{ paddingHorizontal: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {cells.map((c) => <MetricCell key={c.label} {...c} />)}
                </View>
            ) : (
                <View style={{ paddingVertical: 24, alignItems: 'center', gap: 10 }}>
                    <Ionicons name="analytics-outline" size={32} color={theme.textSecondary} style={{ opacity: 0.4 }} />
                    <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center', maxWidth: 240 }}>
                        {i18n.t('traffic_stats_placeholder')}
                    </Text>
                </View>
            )}
        </View>
    );
}
