import { ThemedText } from '@/components/themed-text';
import i18n from '@/constants/language';
import { getStoreValue } from '@/database/store';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

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
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}>
                <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: iconColor, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={iconName} size={16} color="#fff" />
                </View>
                <ThemedText style={{ flex: 1, fontSize: 15 }}>{label}</ThemedText>
                {children}
            </View>
            {!isLast && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.glassBorder, marginLeft: 44 }} />}
        </View>
    );
}

/** System status rows — no card background; wrap in a card at the call site. */
export function InfoCard({ connected }: { connected: boolean }) {
    const ua = getSingBoxUserAgent();
    const [bestDns, setBestDns] = useState<string>('—');

    useEffect(() => {
        getStoreValue('directDNS', '—').then(setBestDns);
    }, [connected]);

    const handleCopyUA = () => {
        Clipboard.setStringAsync(ua);
        if (Platform.OS === 'android') ToastAndroid.show(i18n.t('copied'), ToastAndroid.SHORT);
    };

    return (
        <View>
            <InfoRow iconName="radio-outline" iconColor={connected ? '#34C759' : '#8E8E93'} label={i18n.t('run_status')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? '#34C759' : '#8E8E93' }} />
                    <ThemedText style={{ fontSize: 14, fontWeight: '500', color: connected ? '#34C759' : '#8E8E93' }}>
                        {connected ? i18n.t('running') : i18n.t('not_connected')}
                    </ThemedText>
                </View>
            </InfoRow>

            <InfoRow iconName="globe-outline" iconColor="#32ADE6" label={i18n.t('dns_server')}>
                <ThemedText style={{ fontSize: 14, fontFamily: MONO_FONT }} themeColor="textSecondary">
                    {bestDns}
                </ThemedText>
            </InfoRow>

            <InfoRow iconName="finger-print-outline" iconColor="#5856D6" label={i18n.t('user_agent')} isLast>
                <View style={{ flexDirection: 'row', flex: 1, gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={{ flexShrink: 1 }}
                        contentContainerStyle={{ alignItems: 'center' }}
                    >
                        <ThemedText style={{ fontSize: 10, fontFamily: MONO_FONT }} themeColor="textSecondary">
                            {ua}
                        </ThemedText>
                    </ScrollView>
                    <Pressable onPress={handleCopyUA} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                        <Ionicons name="copy-outline" size={14} color="#8E8E93" />
                    </Pressable>
                </View>
            </InfoRow>
        </View>
    );
}
