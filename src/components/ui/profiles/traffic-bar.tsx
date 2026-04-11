import { fmtBytes } from '@/components/ui/home/profile-info-card';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { TrafficIndicator } from './traffic-indicator';

export function TrafficBar({ used, total }: { used: number; total: number }) {
    const theme = useTheme();
    const hasData = total > 0;
    const pct = hasData ? Math.min((used / total) * 100, 100) : 0;
    const nearLimit = pct > 85;
    const remaining = Math.max(0, total - used);
    const color = nearLimit ? '#FF3B30' : '#007AFF';

    return (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 12, paddingTop: 4 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ width: 20, alignItems: 'center', paddingTop: 2 }}>
                        <Ionicons name="cloud-upload-outline" size={16} color={theme.textSecondary} />
                    </View>
                    <View>
                        <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
                            {i18n.t('traffic_used')}
                        </Text>
                        <Text style={{ fontSize: 16, color: theme.text, fontWeight: '600' }}>
                            {hasData ? fmtBytes(used) : '-'}
                        </Text>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ width: 20, alignItems: 'center', paddingTop: 2 }}>
                        <Ionicons name="cloud-download-outline" size={16} color={nearLimit ? '#FF3B30' : theme.textSecondary} />
                    </View>
                    <View>
                        <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
                            {i18n.t('traffic_remaining')}
                        </Text>
                        <Text style={{ fontSize: 16, color: nearLimit ? '#FF3B30' : theme.text, fontWeight: '600' }}>
                            {hasData ? fmtBytes(remaining) : '-'}
                        </Text>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ width: 20, alignItems: 'center', paddingTop: 2 }}>
                        <Ionicons name="server-outline" size={16} color={theme.textSecondary} />
                    </View>
                    <View>
                        <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
                            {i18n.t('traffic_total')}
                        </Text>
                        <Text style={{ fontSize: 16, color: theme.text, fontWeight: '600' }}>
                            {hasData ? fmtBytes(total) : '-'}
                        </Text>
                    </View>
                </View>
            </View>
            <TrafficIndicator percentage={pct} color={color} hasData={hasData} textSecondaryColor={theme.textSecondary} />
        </View>
    );
}
