import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Subscription } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { urlHostname } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { TrafficBar } from './traffic-bar';

export function ActiveProfileCard({
    sub,
    refreshing,
    onRefresh,
}: {
    sub: Subscription;
    refreshing: boolean;
    onRefresh: () => void;
}) {
    const theme = useTheme();
    const isZh = i18n.locale.startsWith('zh');

    const expireDate = sub.expireTime > 0
        ? new Date(sub.expireTime * 1000).toLocaleDateString(
            isZh ? 'zh-CN' : 'en-US',
            isZh
                ? { year: 'numeric', month: 'long', day: 'numeric' }
                : { year: 'numeric', month: 'short', day: 'numeric' }
        )
        : null;

    const daysLeft = sub.expireTime > 0
        ? Math.max(0, Math.ceil((sub.expireTime * 1000 - Date.now()) / 86400000))
        : null;

    const daysLeftColor = daysLeft !== null && daysLeft < 30 ? '#FF3B30' : theme.text;
    const hasData = sub.totalTraffic > 0 || sub.expireTime > 0;

    if (hasData) {
        return (
            <View className='px-2'>
                {/* Header: Name + Refresh button */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        <View style={{ width: 20, alignItems: 'center' }}>
                            <Ionicons name="document-text-outline" size={16} color={theme.text} />
                        </View>
                        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, flex: 1 }}>
                            {sub.name || i18n.t('remote_config')}
                        </Text>
                    </View>
                    <Pressable
                        disabled={refreshing}
                        onPress={() => { if (!refreshing) { mediumImpact(); onRefresh(); } }}
                        style={({ pressed }) => ({
                            opacity: refreshing ? 0.4 : (pressed ? 0.6 : 1),
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                        })}
                    >
                        <Ionicons
                            name="refresh-outline"
                            size={14}
                            color={refreshing ? theme.textSecondary : '#007AFF'}
                        />
                        <Text style={{ fontSize: 12, color: refreshing ? theme.textSecondary : '#007AFF' }}>
                            {refreshing ? i18n.t('sub_refreshing') : i18n.t('sub_refresh')}
                        </Text>
                    </Pressable>
                </View>

                {/* Info rows */}
                <View style={{ gap: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 20, alignItems: 'center' }}>
                            <Ionicons name="link-outline" size={16} color={theme.textSecondary} />
                        </View>
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>{urlHostname(sub.url, sub.url)}</Text>
                    </View>

                    <TrafficBar used={sub.usedTraffic} total={sub.totalTraffic} />

                    {expireDate ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <View style={{ width: 20, alignItems: 'center' }}>
                                <Ionicons name="calendar-outline" size={16} color={daysLeftColor} />
                            </View>
                            <Text style={{ fontSize: 13, color: daysLeftColor }}>
                                {expireDate}
                                {daysLeft !== null && ` ${i18n.t('days_remaining', { days: daysLeft })}`}
                            </Text>
                        </View>
                    ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <View style={{ width: 20, alignItems: 'center' }}>
                                <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
                            </View>
                            <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                                {i18n.t('config_no_expire')}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        );
    }

    // No data: compact layout with title, URL, and refresh button
    return (
        <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
                    {i18n.t('remote_config')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="link-outline" size={14} color={theme.textSecondary} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>
                        {urlHostname(sub.url, sub.url)}
                    </Text>
                </View>
            </View>

            <Pressable
                disabled={refreshing}
                onPress={() => { if (!refreshing) { mediumImpact(); onRefresh(); } }}
                style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: refreshing ? 0.4 : (pressed ? 0.6 : 1),
                })}
            >
                <Ionicons
                    name="refresh-outline"
                    size={24}
                    color={refreshing ? theme.textSecondary : '#007AFF'}
                />
            </Pressable>
        </View>
    );
}
