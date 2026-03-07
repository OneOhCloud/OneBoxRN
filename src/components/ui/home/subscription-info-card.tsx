import { ThemedText } from '@/components/themed-text';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { View } from 'react-native';

export function fmtBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export interface SubInfo {
    used: number;
    total: number;
    expire: number;
}

export function SubscriptionInfoCard({ info }: { info: SubInfo }) {
    const theme = useTheme();
    if (info.expire === 0 && info.total <= 1) return null;

    const remaining = Math.max(0, info.total - info.used);
    const expireDate =
        info.expire > 0
            ? new Date(info.expire * 1000).toLocaleDateString(
                i18n.locale.startsWith('zh') ? 'zh-CN' : 'en-US',
                { year: 'numeric', month: '2-digit', day: '2-digit' }
            )
            : i18n.t('no_expire_info');

    return (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <View
                style={{
                    flex: 1,
                    backgroundColor: theme.backgroundElement,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    alignItems: 'center',
                }}
            >
                <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={{ fontSize: 11, letterSpacing: 0.2 }}
                >
                    {i18n.t('expire_time')}
                </ThemedText>
                <ThemedText style={{ fontSize: 14, fontWeight: '600', marginTop: 3 }}>
                    {expireDate}
                </ThemedText>
            </View>
            <View
                style={{
                    flex: 1,
                    backgroundColor: theme.backgroundElement,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    alignItems: 'center',
                }}
            >
                <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={{ fontSize: 11, letterSpacing: 0.2 }}
                >
                    {i18n.t('remaining_traffic')}
                </ThemedText>
                <ThemedText style={{ fontSize: 14, fontWeight: '600', marginTop: 3 }}>
                    {fmtBytes(remaining)}
                </ThemedText>
            </View>
        </View>
    );
}
