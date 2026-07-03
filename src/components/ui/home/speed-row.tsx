import { ThemedText } from '@/components/themed-text';
import { useVpn } from '@/contexts/vpn-context';
import { formatBytes } from '@/utils/format-bytes';
import { Platform, View } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** Real-time uplink/downlink speed display */
export function SpeedRow() {
    const { traffic } = useVpn();
    // Format from raw with the shared formatter, not the divergent native
    // *Display strings (audit C10).
    const uplink = traffic ? formatBytes(traffic.uplink) + '/s' : '0 B/s';
    const downlink = traffic ? formatBytes(traffic.downlink) + '/s' : '0 B/s';
    return (
        <View style={{ flexDirection: 'row', gap: 24 }}>
            {[
                { arrow: '↑', value: uplink },
                { arrow: '↓', value: downlink },
            ].map(({ arrow, value }) => (
                <View
                    key={arrow}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 999,
                        gap: 6,
                    }}
                >
                    <ThemedText themeColor="textSecondary" style={{ fontSize: 12, fontWeight: '700' }}>
                        {arrow}
                    </ThemedText>
                    <ThemedText style={{ fontSize: 12, fontFamily: MONO_FONT }}>{value}</ThemedText>
                </View>
            ))}
        </View>
    );
}
