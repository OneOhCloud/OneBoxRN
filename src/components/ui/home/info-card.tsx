import { SettingsRow } from '@/components/ui/ios26/settings-row';
import i18n from '@/constants/language';
import { Fonts, TabularNums } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { extractSystemDns } from '@/database/helper';
import { useTheme } from '@/hooks/use-theme';
import { getSingBoxUserAgent } from '@/utils';
import { jsLog } from '@/utils/log-sink';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Platform, Pressable, Text, ToastAndroid, View } from 'react-native';

function StatusCapsule({ connected }: { connected: boolean }) {
    const color = connected ? '#34C759' : '#8E8E93';
    const bg = connected ? 'rgba(52,199,89,0.14)' : 'rgba(142,142,147,0.16)';
    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: bg,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
            }}
        >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
            <Text
                style={{
                    fontSize: 13,
                    fontFamily: Fonts?.rounded,
                    fontWeight: '700',
                    color,
                    letterSpacing: -0.1,
                }}
            >
                {connected ? i18n.t('running') : i18n.t('not_connected')}
            </Text>
        </View>
    );
}

function CopyButton({ onPress, tint }: { onPress: () => void; tint: string }) {
    return (
        <Pressable
            onPress={onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('copied')}
            style={({ pressed }) => ({
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: `${tint}1E`,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.55 : 1,
            })}
        >
            <Ionicons name="copy-outline" size={14} color={tint} />
        </Pressable>
    );
}

export function InfoCard({ connected }: { connected: boolean }) {
    const theme = useTheme();
    const { directDns, getStartConfig, refreshDirectDns } = useVpn();

    // Memoized — getSingBoxUserAgent() calls expo-device which can throw on
    // web in restricted contexts. Catching here keeps the route alive.
    const ua = useMemo(() => {
        try {
            return getSingBoxUserAgent();
        } catch (e) {
            jsLog.warn('[InfoCard] getSingBoxUserAgent failed:', e);
            return '—';
        }
    }, []);

    const launchDns = useMemo(
        () => (connected ? (extractSystemDns(getStartConfig()) ?? '—') : '—'),
        [connected, getStartConfig]
    );

    // On every focus, re-probe the direct DNS so Settings always shows the
    // same value as the merged config. Single-flight is enforced by VpnContext.
    useFocusEffect(
        useCallback(() => {
            if (connected) return;
            refreshDirectDns().catch((e: unknown) => {
                jsLog.warn('[InfoCard] refreshDirectDns failed:', e);
            });
        }, [connected, refreshDirectDns])
    );

    const handleCopyUA = () => {
        try {
            Clipboard.setStringAsync(ua);
            if (Platform.OS === 'android') ToastAndroid.show(i18n.t('copied'), ToastAndroid.SHORT);
        } catch (e) {
            console.warn('[InfoCard] copy failed:', e);
        }
    };

    return (
        <View>
            <SettingsRow
                iconName="radio-outline"
                iconColor="#007AFF"
                label={i18n.t('run_status')}
                trailing={<StatusCapsule connected={connected} />}
            />

            <SettingsRow
                iconName="server-outline"
                iconColor="#007AFF"
                label={i18n.t('dns_server')}
                value={connected ? launchDns : directDns}
                valueMono
            />

            <SettingsRow
                iconName="finger-print-outline"
                iconColor="#007AFF"
                label={i18n.t('user_agent')}
                isLast
                trailing={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, maxWidth: 180 }}>
                        <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={{
                                flexShrink: 1,
                                fontSize: 11,
                                fontFamily: Fonts?.mono,
                                color: theme.textSecondary,
                                fontVariant: TabularNums,
                            }}
                        >
                            {ua}
                        </Text>
                        <CopyButton onPress={handleCopyUA} tint="#007AFF" />
                    </View>
                }
            />
        </View>
    );
}
