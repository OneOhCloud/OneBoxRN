import { fmtBytes } from '@/utils';
import { mediumImpact } from '@/components/ui/haptics';
import { RotatingBorder } from '@/components/ui/profiles/rotating-border';
import {
    ACCENT,
    ACCENT_LIGHT,
    ALERT,
    SILVER_DARK,
    SILVER_LIGHT,
    useGlassSurface,
    WARN,
} from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts, TabularNums } from '@/constants/theme';
import { Profile } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View, useColorScheme } from 'react-native';

function usageColor(pct: number, isDark: boolean): string {
    if (pct >= 85) return ALERT;
    if (pct >= 60) return WARN;
    return isDark ? ACCENT : ACCENT_LIGHT;
}

function Gauge({
    pct,
    fillColor,
    trackColor,
}: { pct: number; fillColor: string; trackColor: string }) {
    const clamped = Math.min(Math.max(pct, 0), 100);
    const minVisible = clamped > 0 ? Math.max(clamped, 2) : 0;
    return (
        <View
            style={{
                height: 10,
                borderRadius: 5,
                backgroundColor: trackColor,
                overflow: 'hidden',
            }}
        >
            <View
                style={{
                    width: `${minVisible}%`,
                    height: '100%',
                    backgroundColor: fillColor,
                    borderRadius: 5,
                }}
            />
        </View>
    );
}

export function ActiveProfileCard({
    sub,
    refreshing,
    onRefresh,
}: {
    sub: Profile;
    refreshing?: boolean;
    onRefresh?: () => void;
}) {
    const theme = useTheme();
    const isDark = useColorScheme() === 'dark';
    const glass = useGlassSurface();
    const accentBlue = isDark ? ACCENT : ACCENT_LIGHT;
    const [cardSize, setCardSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

    const handleLayout = (e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        setCardSize(prev => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    };

    // While a refresh is in-flight the button is invisible but still occupies
    // its 32×32 slot so the header row height stays constant and the card
    // doesn't jump. The rotating border is the sole visual affordance for
    // the in-flight state.
    const refreshBtn = onRefresh ? (
        <Pressable
            onPress={() => { mediumImpact(); onRefresh(); }}
            hitSlop={8}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('sub_refresh')}
            style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: refreshing ? 0 : pressed ? 0.55 : 1,
            })}
        >
            <Ionicons name="refresh" size={16} color={accentBlue} />
        </Pressable>
    ) : null;

    const hasTraffic = sub.totalTraffic > 0;
    const pct = hasTraffic
        ? Math.min((sub.usedTraffic / sub.totalTraffic) * 100, 100)
        : 0;
    const fillColor = hasTraffic ? usageColor(pct, isDark) : theme.textSecondary;
    const trackColor = isDark ? SILVER_DARK : SILVER_LIGHT;

    // Mount snapshot keeps render pure (react-hooks/purity). Day-granularity
    // value; the card remounts on profile switch, so staleness across a
    // midnight while mounted is acceptable.
    const [now] = useState(() => Date.now());
    const daysLeft =
        sub.expireTime > 0
            ? Math.max(0, Math.ceil((sub.expireTime * 1000 - now) / 86400000))
            : null;
    const daysColor = daysLeft !== null && daysLeft < 30 ? ALERT : theme.textSecondary;

    const displayName = sub.name || i18n.t('remote_config');

    const usedFmt = hasTraffic ? fmtBytes(sub.usedTraffic) : i18n.t('no_expire_info');
    const totalFmt = hasTraffic ? fmtBytes(sub.totalTraffic) : i18n.t('no_expire_info');
    const pctLabel = hasTraffic ? `${Math.round(pct)}%` : i18n.t('no_expire_info');

    const a11yLabel = hasTraffic
        ? `${displayName}. ${i18n.t('traffic_used')} ${Math.round(pct)}%. ` +
          `${usedFmt} / ${totalFmt}` +
          (daysLeft !== null
              ? `. ${i18n.t('meta_expires_in', { days: daysLeft })}`
              : '')
        : `${displayName}. ${i18n.t('profile_no_usage')}`;

    return (
        <View
            style={[glass, { padding: 20, gap: 16 }]}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={a11yLabel}
            onLayout={handleLayout}
        >
            <RotatingBorder
                width={cardSize.w}
                height={cardSize.h}
                radius={22}
                active={!!refreshing}
                color={accentBlue}
            />
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
            >
                <Text
                    style={{
                        fontSize: 12,
                        fontFamily: Fonts?.sans,
                        fontWeight: '500',
                        color: theme.textSecondary,
                        letterSpacing: 0.1,
                    }}
                >
                    {i18n.t('sub_active')}
                </Text>
                {refreshBtn}
            </View>

            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                }}
            >
                <Text
                    numberOfLines={1}
                    style={{
                        flex: 1,
                        fontSize: 26,
                        fontFamily: Fonts?.rounded,
                        fontWeight: '700',
                        color: theme.text,
                        letterSpacing: -0.6,
                        lineHeight: 32,
                    }}
                >
                    {displayName}
                </Text>

                <View
                    style={{
                        backgroundColor: isDark
                            ? `${fillColor}2A`
                            : `${fillColor}1E`,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 15,
                            fontFamily: Fonts?.rounded,
                            fontWeight: '700',
                            color: fillColor,
                            letterSpacing: -0.2,
                            fontVariant: TabularNums,
                        }}
                    >
                        {pctLabel}
                    </Text>
                </View>
            </View>

            <Gauge pct={pct} fillColor={fillColor} trackColor={trackColor} />

            <View
                style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Text
                    style={{
                        fontSize: 14,
                        fontFamily: Fonts?.sans,
                        fontWeight: '500',
                        color: theme.textSecondary,
                        fontVariant: TabularNums,
                    }}
                >
                    <Text style={{ color: theme.text, fontWeight: '600' }}>{usedFmt}</Text>
                    {' / '}
                    {totalFmt}
                </Text>
                {daysLeft !== null ? (
                    <Text
                        style={{
                            fontSize: 14,
                            fontFamily: Fonts?.sans,
                            fontWeight: '500',
                            color: daysColor,
                            fontVariant: TabularNums,
                        }}
                    >
                        {i18n.t('meta_expires_in', { days: daysLeft })}
                    </Text>
                ) : (
                    <Text
                        style={{
                            fontSize: 14,
                            fontFamily: Fonts?.sans,
                            fontWeight: '500',
                            color: theme.textSecondary,
                        }}
                    >
                        {i18n.t('no_expire_info')}
                    </Text>
                )}
            </View>
        </View>
    );
}

