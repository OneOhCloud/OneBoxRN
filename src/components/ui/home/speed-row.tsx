import { ThemedText } from '@/components/themed-text';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { Platform, View } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** Real-time uplink/downlink speed display */
export function SpeedRow() {
    const theme = useTheme();
    const { traffic } = useVpn();
    const uplink = traffic?.uplinkDisplay || '0 B/s';
    const downlink = traffic?.downlinkDisplay || '0 B/s';
    return (
        <View style={{ flexDirection: 'row', gap: 10 }}>
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
                        backgroundColor: theme.backgroundElement,
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
