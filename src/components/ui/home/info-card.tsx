import { ThemedText } from '@/components/themed-text';
import { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { getStoreValue } from '@/database/store';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, ToastAndroid, View } from 'react-native';

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



export function InfoCard({ connected }: { connected: boolean }) {
    const theme = useTheme();
    const version = ExpoOneBox.getLibBoxVersion();
    const ua = getSingBoxUserAgent();
    const [bestDns, setBestDns] = useState<string>("loading...");

    useEffect(() => {
        const fetchBestDns = async () => {
            setBestDns(await getStoreValue('directDNS', '未知'));
        };
        fetchBestDns();
    }, [connected]);


    const handleCopyUA = () => {
        Clipboard.setStringAsync(ua);
        if (Platform.OS === 'android') {
            ToastAndroid.show(i18n.t('copied'), ToastAndroid.SHORT);
        } else if (Platform.OS === 'web') {
            alert('User Agent ' + i18n.t('copied'));
        }
    };

    return (
        <View>
            <SectionLabel text={i18n.t('system_info')} />
            <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 16, paddingHorizontal: 14 }}>
                {/* Kernel version */}
                <InfoRow iconName="cube-outline" iconColor="#5856D6" label={i18n.t('kernel_version')}>
                    <ThemedText style={{ fontSize: 14, fontFamily: MONO_FONT, fontWeight: '500' }} themeColor="textSecondary">
                        {version || '—'}
                    </ThemedText>
                </InfoRow>

                {/* Run status */}
                <InfoRow iconName="radio-outline" iconColor={connected ? '#34C759' : '#8E8E93'} label={i18n.t('run_status')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? '#34C759' : '#8E8E93' }} />
                        <ThemedText style={{ fontSize: 14, fontWeight: '500', color: connected ? '#34C759' : '#8E8E93' }}>
                            {connected ? i18n.t('running') : i18n.t('not_connected')}
                        </ThemedText>
                    </View>
                </InfoRow>
                {/* Best DNS */}
                <InfoRow iconName="globe-outline" iconColor="#30B0C7" label={i18n.t('dns_server')}>
                    <ThemedText style={{ fontSize: 14, fontFamily: MONO_FONT }} themeColor="textSecondary">
                        {bestDns || i18n.t('loading_dns')}
                    </ThemedText>
                </InfoRow>

                {/* User Agent */}
                <InfoRow iconName="finger-print-outline" iconColor="#FF9500" label={i18n.t('user_agent')} isLast>
                    <View className='flex-row flex-1 gap-2 items-center '>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{
                                flexShrink: 1,
                                borderRadius: 8,
                            }}
                            contentContainerStyle={{ alignItems: 'center' }}
                        >
                            <ThemedText
                                style={{ fontSize: 10, fontFamily: MONO_FONT }} themeColor="textSecondary">
                                {ua}
                            </ThemedText>
                        </ScrollView>
                        <Pressable
                            onPress={handleCopyUA}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                        >
                            <Ionicons name="copy-outline" size={14} color={theme.textSecondary} />
                        </Pressable>
                    </View>
                </InfoRow>
            </View>
        </View>
    );
}