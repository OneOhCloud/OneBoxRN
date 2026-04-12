import { fmtBytes } from '@/components/ui/home/profile-info-card';
import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { Profile } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from 'react-native';

// ─── Design tokens — iOS 26 "Liquid Glass" × cool chrome ────────────────────
// Blue + silver + gray + white. The accent is restrained, the chrome is quiet,
// and materials feel translucent even without a real blur backend.
const ACCENT        = '#0A84FF';  // iOS system blue (dark-adapted)
const ACCENT_LIGHT  = '#007AFF';  // iOS system blue (light)
const WARN          = '#FF9F0A';  // iOS system orange
const ALERT         = '#FF453A';  // iOS system red
const INK           = '#0B0D12';  // cool near-black
const PAPER         = '#F2F3F7';  // cool off-white with blue hint
const SILVER_LIGHT  = '#D1D5DB';  // quiet chrome (light mode)
const SILVER_DARK   = '#3A3E4B';  // quiet chrome (dark mode)

function usageColor(pct: number, isDark: boolean): string {
    if (pct >= 85) return ALERT;
    if (pct >= 60) return WARN;
    return isDark ? ACCENT : ACCENT_LIGHT;
}

// ─── Liquid Glass surface ──────────────────────────────────────────────────
// A translucent panel with a subtle 1px top inner border (the "glass edge
// highlight") and a diffuse ambient shadow. Approximates iOS 26's material
// without a real blur backend — honest fake.
export function useGlassSurface() {
    const isDark = useColorScheme() === 'dark';
    return {
        backgroundColor: isDark ? 'rgba(28, 32, 42, 0.72)' : 'rgba(255, 255, 255, 0.78)',
        borderRadius: 22,
        borderWidth: 1,
        borderColor: isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.95)',
        // soft diffuse shadow
        shadowColor: '#0B1628',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: isDark ? 0.35 : 0.08,
        shadowRadius: 24,
        elevation: 6,
    } as const;
}

// Horizontal progress bar with a silver track + blue fill + rounded caps.
// Proportioned to feel like an iOS 26 Gauge (thicker than iOS 17's thin bars).
function Gauge({
    pct,
    fillColor,
    trackColor,
}: { pct: number; fillColor: string; trackColor: string }) {
    const clamped = Math.max(2, Math.min(pct, 100));
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
                    width: `${clamped}%`,
                    height: '100%',
                    backgroundColor: fillColor,
                    borderRadius: 5,
                }}
            />
        </View>
    );
}

// ─── Micro label (SF caption, not uppercase — keeps iOS 26 softness) ────────
export function MicroLabel({
    children,
    color,
    style,
}: {
    children: React.ReactNode;
    color: string;
    style?: object;
}) {
    return (
        <Text
            style={[
                {
                    fontSize: 12,
                    fontFamily: Fonts?.sans,
                    color,
                    letterSpacing: 0.1,
                    fontWeight: '500',
                },
                style,
            ]}
        >
            {children}
        </Text>
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

    // Small circular refresh button — sits at the top-right of the card.
    const refreshBtn = onRefresh ? (
        <Pressable
            onPress={() => { if (!refreshing) { mediumImpact(); onRefresh(); } }}
            disabled={refreshing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('sub_refresh')}
            accessibilityState={{ busy: !!refreshing }}
            style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: refreshing ? 0.55 : (pressed ? 0.55 : 1),
            })}
        >
            {refreshing ? (
                <ActivityIndicator size="small" color={accentBlue} />
            ) : (
                <Ionicons name="refresh" size={16} color={accentBlue} />
            )}
        </Pressable>
    ) : null;

    const hasTraffic = sub.totalTraffic > 0;
    const pct = hasTraffic
        ? Math.min((sub.usedTraffic / sub.totalTraffic) * 100, 100)
        : 0;
    const fillColor = usageColor(pct, isDark);
    const trackColor = isDark ? SILVER_DARK : SILVER_LIGHT;

    const daysLeft =
        sub.expireTime > 0
            ? Math.max(0, Math.ceil((sub.expireTime * 1000 - Date.now()) / 86400000))
            : null;
    const daysColor = daysLeft !== null && daysLeft < 30 ? ALERT : theme.textSecondary;

    const displayName = sub.name || i18n.t('remote_config');

    // ── No-data fallback ────────────────────────────────────────────────
    if (!hasTraffic) {
        return (
            <View
                style={[glass, { padding: 20, gap: 6 }]}
                accessible
                accessibilityRole="summary"
                accessibilityLabel={`${displayName}. ${i18n.t('sub_empty_desc')}`}
            >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                        <Text
                            numberOfLines={1}
                            style={{
                                fontSize: 22,
                                fontFamily: Fonts?.rounded,
                                fontWeight: '700',
                                color: theme.text,
                                letterSpacing: -0.4,
                            }}
                        >
                            {displayName}
                        </Text>
                        <Text
                            style={{
                                fontSize: 14,
                                fontFamily: Fonts?.sans,
                                color: theme.textSecondary,
                            }}
                        >
                            {i18n.t('sub_empty_desc')}
                        </Text>
                    </View>
                    {refreshBtn}
                </View>
            </View>
        );
    }

    const usedFmt = fmtBytes(sub.usedTraffic);
    const totalFmt = fmtBytes(sub.totalTraffic);
    const a11yLabel =
        `${displayName}. ${i18n.t('traffic_used')} ${Math.round(pct)}%. ` +
        `${usedFmt} / ${totalFmt}` +
        (daysLeft !== null
            ? `. ${i18n.t('meta_expires_in', { days: daysLeft })}`
            : '');

    return (
        <View
            style={[glass, { padding: 20, gap: 16 }]}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={a11yLabel}
        >
            {/* ── Top strip — caption on left, refresh button on right ──── */}
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
            >
                <MicroLabel color={theme.textSecondary}>
                    {i18n.t('sub_active')}
                </MicroLabel>
                {refreshBtn}
            </View>

            {/* ── Title row — rounded name + percentage pill ────────────── */}
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

                {/* Percentage pill — iOS 26 style capsule with tinted surface */}
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
                            fontVariant: ['tabular-nums'],
                        }}
                    >
                        {Math.round(pct)}%
                    </Text>
                </View>
            </View>

            {/* ── Gauge ──────────────────────────────────────────────────── */}
            <Gauge pct={pct} fillColor={fillColor} trackColor={trackColor} />

            {/* ── Footer — used/total + expire ───────────────────────────── */}
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
                        fontVariant: ['tabular-nums'],
                    }}
                >
                    <Text style={{ color: theme.text, fontWeight: '600' }}>{usedFmt}</Text>
                    {' / '}
                    {totalFmt}
                </Text>
                {daysLeft !== null && (
                    <Text
                        style={{
                            fontSize: 14,
                            fontFamily: Fonts?.sans,
                            fontWeight: '500',
                            color: daysColor,
                            fontVariant: ['tabular-nums'],
                        }}
                    >
                        {i18n.t('meta_expires_in', { days: daysLeft })}
                    </Text>
                )}
            </View>
        </View>
    );
}

// Exports for reuse
export { ACCENT, ACCENT_LIGHT, ALERT, INK, PAPER, SILVER_DARK, SILVER_LIGHT, WARN };
