import { ThemedText } from '@/components/themed-text';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox';
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
    const theme = useTheme();
    return (
        // width: '48%' in a flexWrap row gives a reliable 2-column grid.
        // flex: 1 alone causes each cell to fill the full row width in RN's flexWrap.
        <View style={{ width: '48%', backgroundColor: theme.cardBackground, borderRadius: 10, padding: 12, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name={iconName} size={13} color={iconColor} />
                <ThemedText style={{ fontSize: 11, fontWeight: '600', color: iconColor, letterSpacing: 0.2 }}>
                    {label}
                </ThemedText>
            </View>
            <ThemedText numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', fontFamily: MONO_FONT, letterSpacing: -0.5 }}>
                {value}
            </ThemedText>
        </View>
    );
}

// ─── Traffic Card ───────────────────────────────────────────
/** Traffic metric grid with its own backgroundElement card shell. */
export default function TrafficCard({ traffic }: { traffic: TrafficUpdateEventPayload | null }) {
    const theme = useTheme();

    function fmt(n: number) {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
        return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    const cells: MetricCellProps[] = traffic ? [
        { iconName: 'arrow-up-outline',       iconColor: '#FF3B30', label: i18n.t('uplink_speed'),          value: traffic.uplinkDisplay       || fmt(traffic.uplink) + '/s' },
        { iconName: 'arrow-down-outline',      iconColor: '#34C759', label: i18n.t('downlink_speed'),        value: traffic.downlinkDisplay     || fmt(traffic.downlink) + '/s' },
        { iconName: 'cloud-upload-outline',    iconColor: '#FF6B35', label: i18n.t('uplink_total'),          value: traffic.uplinkTotalDisplay  || fmt(traffic.uplinkTotal) },
        { iconName: 'cloud-download-outline',  iconColor: '#30B0C7', label: i18n.t('downlink_total'),        value: traffic.downlinkTotalDisplay || fmt(traffic.downlinkTotal) },
        { iconName: 'hardware-chip-outline',   iconColor: '#5856D6', label: i18n.t('memory_usage'),          value: traffic.memoryDisplay       || fmt(traffic.memory) },
        { iconName: 'git-branch-outline',      iconColor: '#AF52DE', label: i18n.t('goroutines'),            value: String(traffic.goroutines) },
        { iconName: 'enter-outline',           iconColor: '#007AFF', label: i18n.t('inbound_connections'),   value: String(traffic.connectionsIn) },
        { iconName: 'exit-outline',            iconColor: '#FF9500', label: i18n.t('outbound_connections'),  value: String(traffic.connectionsOut) },
    ] : [];

    return (
        <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 12 }}>
            {traffic ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
