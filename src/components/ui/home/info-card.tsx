import { SettingsRow } from '@/components/ui/ios26/settings-row';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { getStoreValue } from '@/database/store';
import { useTheme } from '@/hooks/use-theme';
import { getSingBoxUserAgent } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, ToastAndroid, View } from 'react-native';

// ─── Status capsule — iOS 26 tinted pill ───────────────────────────────────
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

// ─── Copy-to-clipboard tint pill ───────────────────────────────────────────
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

/** System status rows — no card background; wrap in a card at the call site. */
export function InfoCard({ connected }: { connected: boolean }) {
    const theme = useTheme();

    // Lazy-init so any platform-specific throw (e.g. expo-device on web)
    // doesn't tear down the whole route at render time.
    const [ua] = useState<string>(() => {
        try {
            return getSingBoxUserAgent();
        } catch (e) {
            console.warn('[InfoCard] getSingBoxUserAgent failed:', e);
            return '—';
        }
    });
    const [bestDns, setBestDns] = useState<string>('—');

    useEffect(() => {
        let cancelled = false;
        getStoreValue('directDNS', '—')
            .then(v => { if (!cancelled) setBestDns(v); })
            .catch(e => {
                if (!cancelled) {
                    console.warn('[InfoCard] getStoreValue failed:', e);
                    setBestDns('—');
                }
            });
        return () => { cancelled = true; };
    }, [connected]);

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
            {/* Run status — tinted capsule */}
            <SettingsRow
                iconName="radio-outline"
                iconColor={connected ? '#34C759' : '#8E8E93'}
                label={i18n.t('run_status')}
                trailing={<StatusCapsule connected={connected} />}
            />

            {/* DNS server — mono value */}
            <SettingsRow
                iconName="globe-outline"
                iconColor="#32ADE6"
                label={i18n.t('dns_server')}
                value={bestDns}
                valueMono
            />

            {/* User-Agent — truncated mono value with tinted copy pill */}
            <SettingsRow
                iconName="finger-print-outline"
                iconColor="#5856D6"
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
                                fontVariant: ['tabular-nums'],
                            }}
                        >
                            {ua}
                        </Text>
                        <CopyButton onPress={handleCopyUA} tint="#5856D6" />
                    </View>
                }
            />
        </View>
    );
}
