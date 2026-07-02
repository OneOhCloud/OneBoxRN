import { lightImpact } from '@/components/ui/haptics';
import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import React, { useEffect } from 'react';
import { Image } from 'expo-image';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    Extrapolation,
    interpolate,
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

interface EmptyStateProps {
    onImportUrl: () => void;
}

const PULSE_DURATION = 3200;
const RING_SIZE = 168;

/**
 * "Quiet signal" onboarding — the app icon sits at the center of a slow radar
 * pulse, suggesting a tunnel waiting to be established. Staggered entry reveal
 * on mount; continuous ring pulses afterwards.
 */
export function EmptyState({ onImportUrl }: EmptyStateProps) {
    const theme = useTheme();
    const accentBlue = useAccentBlue();

    // Three rings share the same animation curve but start at different phases
    // so the viewer always sees at least one ring mid-expansion.
    const ring1 = useSharedValue(0);
    const ring2 = useSharedValue(0);
    const ring3 = useSharedValue(0);

    const reveal = useSharedValue(0);

    useEffect(() => {
        reveal.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });

        const loop = (sv: SharedValue<number>, delay: number) => {
            sv.value = withDelay(
                delay,
                withRepeat(
                    withSequence(
                        withTiming(1, { duration: PULSE_DURATION, easing: Easing.out(Easing.cubic) }),
                        withTiming(0, { duration: 0 }),
                    ),
                    -1,
                ),
            );
        };

        loop(ring1, 0);
        loop(ring2, PULSE_DURATION / 3);
        loop(ring3, (PULSE_DURATION / 3) * 2);

        return () => {
            cancelAnimation(reveal);
            cancelAnimation(ring1);
            cancelAnimation(ring2);
            cancelAnimation(ring3);
        };
    }, [reveal, ring1, ring2, ring3]);

    const ringStyleFromSV = (sv: SharedValue<number>) =>
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useAnimatedStyle(() => ({
            opacity: (1 - sv.value) * 0.35,
            transform: [{ scale: 0.7 + sv.value * 0.9 }],
        }));

    // Three calls in fixed order — order is stable, so the rules-of-hooks
    // disable above is safe here.
    const ring1Style = ringStyleFromSV(ring1);
    const ring2Style = ringStyleFromSV(ring2);
    const ring3Style = ringStyleFromSV(ring3);

    const revealStyleAt = (start: number) =>
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useAnimatedStyle(() => {
            const p = interpolate(reveal.value, [start, 1], [0, 1], Extrapolation.CLAMP);
            return { opacity: p, transform: [{ translateY: (1 - p) * 12 }] };
        });

    const iconReveal = revealStyleAt(0);
    const titleReveal = revealStyleAt(0.25);
    const descReveal = revealStyleAt(0.4);
    const ctaReveal = revealStyleAt(0.55);
    const footReveal = revealStyleAt(0.7);

    const ringStyle = [
        styles.ring,
        { borderColor: accentBlue },
    ];

    return (
        <View style={styles.root}>
            <Animated.View style={[styles.radar, iconReveal]}>
                <Animated.View pointerEvents="none" style={[ringStyle, ring1Style]} />
                <Animated.View pointerEvents="none" style={[ringStyle, ring2Style]} />
                <Animated.View pointerEvents="none" style={[ringStyle, ring3Style]} />

                <Image
                    source={require('../../../../assets/images/icon.png')}
                    style={[
                        styles.icon,
                        Platform.select({
                            ios: {
                                shadowColor: accentBlue,
                                shadowOffset: { width: 0, height: 12 },
                                shadowOpacity: 0.18,
                                shadowRadius: 24,
                            },
                        }),
                    ]}
                    contentFit="contain"
                />
            </Animated.View>

            <Animated.Text style={[styles.title, { color: theme.text }, titleReveal]}>
                {i18n.t('empty_title')}
            </Animated.Text>

            <Animated.Text style={[styles.desc, { color: theme.textSecondary }, descReveal]}>
                {i18n.t('empty_desc')}
            </Animated.Text>

            <Animated.View style={[styles.ctaWrap, ctaReveal]}>
                <Pressable
                    onPress={() => { lightImpact(); onImportUrl(); }}
                    style={({ pressed }) => [
                        styles.cta,
                        {
                            backgroundColor: accentBlue,
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                        },
                        Platform.select({
                            ios: {
                                shadowColor: accentBlue,
                                shadowOffset: { width: 0, height: 8 },
                                shadowOpacity: 0.28,
                                shadowRadius: 16,
                            },
                        }),
                    ]}
                >
                    <Text style={styles.ctaLabel}>
                        {i18n.t('import_config_url')}
                    </Text>
                </Pressable>
            </Animated.View>

            <Animated.Text style={[styles.footnote, { color: theme.textSecondary }, footReveal]}>
                {i18n.t('only_singbox_links')}
            </Animated.Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    radar: {
        width: RING_SIZE,
        height: RING_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
    },
    ring: {
        position: 'absolute',
        width: RING_SIZE,
        height: RING_SIZE,
        borderRadius: RING_SIZE / 2,
        borderWidth: 1.5,
    },
    icon: {
        width: 104,
        height: 104,
        borderRadius: 24,
    },
    title: {
        fontSize: 32,
        fontFamily: Fonts?.rounded,
        fontWeight: '800',
        letterSpacing: -0.8,
        lineHeight: 38,
        textAlign: 'center',
        marginBottom: 10,
    },
    desc: {
        fontSize: 15,
        fontFamily: Fonts?.sans,
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: 40,
        maxWidth: 280,
    },
    ctaWrap: {
        width: '100%',
        maxWidth: 320,
    },
    cta: {
        paddingVertical: 16,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaLabel: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: Fonts?.rounded,
        fontWeight: '700',
        letterSpacing: -0.2,
    },
    footnote: {
        fontSize: 11,
        fontFamily: Fonts?.sans,
        textAlign: 'center',
        marginTop: 18,
        opacity: 0.55,
        letterSpacing: 0.1,
    },
});
