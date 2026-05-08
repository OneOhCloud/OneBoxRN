import { useAccentBlue, useGlassSurface, useHairlineColor } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fmtBytes, SubInfo } from '@/utils';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

interface ProfileSummaryCardProps {
    info: SubInfo;
    name?: string | null;
    connected?: boolean;
}

export function ProfileSummaryCard({ info, name, connected = false }: ProfileSummaryCardProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    const accent = useAccentBlue();
    const glass = useGlassSurface();

    const statusColor = connected ? accent : theme.textSecondary;

    const hasQuota = info.total > 1;
    const hasExpire = info.expire > 0;

    const used = Math.max(0, info.used);
    const total = Math.max(used, info.total);
    const remaining = Math.max(0, total - used);
    const pct = hasQuota && total > 0 ? Math.min(1, used / total) : 0;

    const expireDate = hasExpire
        ? new Date(info.expire * 1000).toLocaleDateString(
            i18n.locale.startsWith('zh') ? 'zh-CN' : 'en-US',
            { year: 'numeric', month: '2-digit', day: '2-digit' },
        )
        : i18n.t('no_expire_info');

    const remainingText = hasQuota ? fmtBytes(remaining) : i18n.t('no_expire_info');

    const fillProgress = useSharedValue(pct);
    useEffect(() => {
        fillProgress.value = withTiming(pct, { duration: 900 });
    }, [pct, fillProgress]);

    const fillStyle = useAnimatedStyle(() => ({
        width: `${fillProgress.value * 100}%`,
    }));

    return (
        <View style={[glass, styles.body]}>

            <View style={styles.topRow}>
                <View style={styles.statusLamp}>
                    <View style={[styles.dot, { backgroundColor: statusColor }]} />
                </View>
                <Text
                    numberOfLines={1}
                    style={[styles.name, { color: theme.text, fontFamily: Fonts?.rounded }]}
                >
                    {name ?? i18n.t('sub_section_info')}
                </Text>
            </View>

            <View style={styles.hero}>
                {hasQuota ? (
                    <Text style={[styles.heroUsed, { color: theme.text, fontFamily: Fonts?.mono }]}>
                        {fmtBytes(used)}
                        <Text style={[styles.heroTotal, { color: theme.textSecondary }]}>
                            {` / ${fmtBytes(total)}`}
                        </Text>
                    </Text>
                ) : (
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.heroPlaceholder,
                            { color: theme.textSecondary, fontFamily: Fonts?.rounded },
                        ]}
                    >
                        {i18n.t('profile_no_usage')}
                    </Text>
                )}
            </View>

            <View style={[styles.rail, { backgroundColor: hairline }]}>
                <Animated.View
                    style={[styles.fill, { backgroundColor: theme.text }, fillStyle]}
                />
            </View>

            <View style={styles.metaRow}>
                <View style={styles.metaCol}>
                    <Text
                        style={[
                            styles.metaLabel,
                            { color: theme.textSecondary, fontFamily: Fonts?.sans },
                        ]}
                    >
                        {i18n.t('expire_time').toUpperCase()}
                    </Text>
                    <Text
                        style={[
                            styles.metaValue,
                            { color: theme.text, fontFamily: Fonts?.rounded },
                        ]}
                    >
                        {expireDate}
                    </Text>
                </View>

                <View style={[styles.metaDivider, { backgroundColor: hairline }]} />

                <View style={styles.metaCol}>
                    <Text
                        style={[
                            styles.metaLabel,
                            { color: theme.textSecondary, fontFamily: Fonts?.sans },
                        ]}
                    >
                        {i18n.t('remaining_traffic').toUpperCase()}
                    </Text>
                    <Text
                        style={[
                            styles.metaValue,
                            { color: theme.text, fontFamily: Fonts?.rounded },
                        ]}
                    >
                        {remainingText}
                    </Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    body: {
        paddingHorizontal: 20,
        paddingVertical: 18,
        gap: 14,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    // Outer lamp housing: 12px box kept constant across states so the name
    // never shifts horizontally when toggling connected/disconnected.
    statusLamp: {
        width: 12,
        height: 12,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        opacity: 0.85,
    },
    name: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: -0.1,
    },
    hero: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 2,
        height: 34,
    },
    heroUsed: {
        fontSize: 28,
        fontWeight: '600',
        letterSpacing: -0.6,
    },
    heroTotal: {
        fontSize: 20,
        fontWeight: '400',
        letterSpacing: -0.4,
    },
    heroPlaceholder: {
        fontSize: 16,
        fontWeight: '500',
        letterSpacing: -0.2,
        opacity: 0.75,
    },
    rail: {
        height: 3,
        borderRadius: 2,
        overflow: 'hidden',
    },
    fill: {
        height: '100%',
        borderRadius: 2,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 2,
    },
    metaCol: {
        flex: 1,
        alignItems: 'center',
        gap: 4,
    },
    metaDivider: {
        width: 1,
        height: 28,
        opacity: 0.6,
    },
    metaLabel: {
        fontSize: 9,
        fontWeight: '600',
        letterSpacing: 1.2,
        opacity: 0.55,
    },
    metaValue: {
        fontSize: 13,
        fontWeight: '500',
        letterSpacing: -0.2,
    },
});
