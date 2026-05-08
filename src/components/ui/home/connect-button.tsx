import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import { ACCENT_LIGHT } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
// Note: `spinStartRef` below is intentionally a SharedValue, not a useRef,
// because the `withTiming` completion callback below is a worklet — once
// it reads a JS ref, Reanimated takes a serializable clone and subsequent
// JS-side mutations of `.current` emit the
// "Tried to modify key 'current' of an object which has been already
// passed to a worklet" warning.
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    runOnJS,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 168;
const RADIUS = SIZE / 2;
const SVG_SIZE = SIZE * 2;
const CENTER = SVG_SIZE / 2;
const STANDBY_FILL = '#FFFFFF';
const STANDBY_INK = '#1C1C1E';

const ARC_RADIUS = RADIUS + 10;
const ARC_CIRC = 2 * Math.PI * ARC_RADIUS;
const SPIN_DURATION_MS = 850;
const SPIN_MIN_REVOLUTIONS = 1.2;
const SPIN_MIN_MS = SPIN_DURATION_MS * SPIN_MIN_REVOLUTIONS;

const ARC_WAKE = ARC_CIRC * 0.25;
const ARC_PLASMA = ARC_CIRC * 0.16;
const ARC_GLOW = ARC_CIRC * 0.12;
const ARC_CORE = ARC_CIRC * 0.12;
const ARC_SPARK = ARC_CIRC * 0.025;
const arcGap = (d: number) => Math.max(0.0001, ARC_CIRC - d);
const DASH_WAKE = `${ARC_WAKE},${arcGap(ARC_WAKE)}`;
const DASH_PLASMA = `${ARC_PLASMA},${arcGap(ARC_PLASMA)}`;
const DASH_GLOW = `${ARC_GLOW},${arcGap(ARC_GLOW)}`;
const DASH_CORE = `${ARC_CORE},${arcGap(ARC_CORE)}`;
const DASH_SPARK = `${ARC_SPARK},${arcGap(ARC_SPARK)}`;


interface ConnectButtonProps {
    connected: boolean;
    loading: boolean;
    onPress: () => void;
}

export function ConnectButton({ connected, loading, onPress }: ConnectButtonProps) {
    const pressScale = useSharedValue(1);
    const loadingProgress = useSharedValue(0);
    const arcOpacity = useSharedValue(0);

    // We can't tie the arc to `loading` directly: the user wants it to keep
    // spinning until at least one full 360° rotation has completed, even if
    // loading flips false earlier. `arcVisible` stays true past `loading`
    // for however long is needed to finish the current cycle.
    const [arcVisible, setArcVisible] = useState(false);
    const spinStart = useSharedValue(0);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }

        if (loading) {
            spinStart.value = Date.now();
            loadingProgress.value = 0;
            loadingProgress.value = withRepeat(
                withTiming(1, { duration: SPIN_DURATION_MS, easing: Easing.linear }),
                -1,
                false,
            );
            setArcVisible(true);
            arcOpacity.value = withTiming(1, { duration: 300 });
            return;
        }

        if (spinStart.value === 0) {
            arcOpacity.value = 0;
            setArcVisible(false);
            loadingProgress.value = 0;
            return;
        }
        // Wind down after at least N full revolutions from start, then fade out.
        const elapsed = Date.now() - spinStart.value;
        const remaining = Math.max(0, SPIN_MIN_MS - elapsed);
        hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            arcOpacity.value = withTiming(0, { duration: 600 }, (finished) => {
                if (finished) {
                    cancelAnimation(loadingProgress);
                    loadingProgress.value = 0;
                    spinStart.value = 0;
                    runOnJS(setArcVisible)(false);
                }
            });
        }, remaining);
    }, [loading, loadingProgress, arcOpacity, spinStart]);

    useEffect(() => () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        cancelAnimation(loadingProgress);
        cancelAnimation(pressScale);
    }, [loadingProgress, pressScale]);

    const containerStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pressScale.value }],
    }));
    const arcFadeStyle = useAnimatedStyle(() => ({
        opacity: arcOpacity.value,
    }));

    const fillProgress = useSharedValue(connected ? 1 : 0);
    useEffect(() => {
        fillProgress.value = withTiming(connected ? 1 : 0, { duration: 280 });
    }, [connected, fillProgress]);

    const blueCircleProps = useAnimatedProps(() => ({
        fillOpacity: fillProgress.value,
    }));

    const arcWakeProps = useAnimatedProps(() => ({ strokeDashoffset: -(loadingProgress.value * ARC_CIRC) }));
    const arcPlasmaProps = useAnimatedProps(() => ({ strokeDashoffset: -(loadingProgress.value * ARC_CIRC) - (ARC_WAKE - ARC_PLASMA) }));
    const arcGlowProps = useAnimatedProps(() => ({ strokeDashoffset: -(loadingProgress.value * ARC_CIRC) - (ARC_WAKE - ARC_GLOW) }));
    const arcCoreProps = useAnimatedProps(() => ({ strokeDashoffset: -(loadingProgress.value * ARC_CIRC) - (ARC_WAKE - ARC_CORE) }));
    const arcSparkProps = useAnimatedProps(() => ({ strokeDashoffset: -(loadingProgress.value * ARC_CIRC) - (ARC_WAKE - ARC_SPARK) }));

    const label = loading ? i18n.t('connecting') : connected ? i18n.t('connected') : i18n.t('connect');

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.animWrapper, containerStyle]}>
                <Svg height={SVG_SIZE} width={SVG_SIZE} style={styles.svgOverlay}>
                    <Defs>
                        <RadialGradient id="glow" cx="50%" cy="50%" rx="50%" ry="50%">
                            <Stop offset="0%" stopColor={ACCENT_LIGHT} stopOpacity="0.4" />
                            <Stop offset="100%" stopColor={ACCENT_LIGHT} stopOpacity="0" />
                        </RadialGradient>
                    </Defs>

                    {connected && (
                        <Circle
                            cx={CENTER}
                            cy={CENTER}
                            r={RADIUS + 24}
                            fill="url(#glow)"
                        />
                    )}

                    {/* White base — always visible */}
                    <Circle
                        cx={CENTER}
                        cy={CENTER}
                        r={RADIUS}
                        fill={STANDBY_FILL}
                    />
                    {/* Blue overlay — fades in when connected */}
                    <AnimatedCircle
                        cx={CENTER}
                        cy={CENTER}
                        r={RADIUS}
                        fill={ACCENT_LIGHT}
                        animatedProps={blueCircleProps}
                    />
                </Svg>

                {arcVisible && (
                    <Animated.View
                        pointerEvents="none"
                        style={[styles.svgOverlay, styles.loadingLayer, arcFadeStyle]}
                    >
                        <Svg height={SVG_SIZE} width={SVG_SIZE}>
                            <AnimatedCircle
                                cx={CENTER} cy={CENTER} r={ARC_RADIUS} fill="none"
                                stroke={ACCENT_LIGHT} strokeOpacity={0.06} strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeDasharray={DASH_WAKE}
                                animatedProps={arcWakeProps}
                            />
                            <AnimatedCircle
                                cx={CENTER} cy={CENTER} r={ARC_RADIUS} fill="none"
                                stroke={ACCENT_LIGHT} strokeOpacity={0.15} strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeDasharray={DASH_PLASMA}
                                animatedProps={arcPlasmaProps}
                            />
                            <AnimatedCircle
                                cx={CENTER} cy={CENTER} r={ARC_RADIUS} fill="none"
                                stroke={ACCENT_LIGHT} strokeOpacity={0.35} strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeDasharray={DASH_GLOW}
                                animatedProps={arcGlowProps}
                            />
                            <AnimatedCircle
                                cx={CENTER} cy={CENTER} r={ARC_RADIUS} fill="none"
                                stroke={ACCENT_LIGHT} strokeOpacity={0.90} strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeDasharray={DASH_CORE}
                                animatedProps={arcCoreProps}
                            />
                            <AnimatedCircle
                                cx={CENTER} cy={CENTER} r={ARC_RADIUS} fill="none"
                                stroke={ACCENT_LIGHT} strokeOpacity={1} strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeDasharray={DASH_SPARK}
                                animatedProps={arcSparkProps}
                            />
                        </Svg>
                    </Animated.View>
                )}

                <Pressable
                    onPress={() => { mediumImpact(); onPress(); }}
                    onPressIn={() => { pressScale.value = withSpring(0.92); }}
                    onPressOut={() => { pressScale.value = withSpring(1); }}
                    disabled={loading}
                    style={styles.content}
                >
                    <Ionicons
                        name="power"
                        size={42}
                        color={connected ? '#ffffff' : STANDBY_INK}
                    />
                    {label !== '' && (
                        <ThemedText
                            style={[
                                styles.text,
                                { color: connected ? '#ffffff' : STANDBY_INK },
                            ]}
                        >
                            {label}
                        </ThemedText>
                    )}
                </Pressable>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: SIZE * 1.5,
        height: SIZE * 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    animWrapper: {
        width: SVG_SIZE,
        height: SVG_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    svgOverlay: {
        position: 'absolute',
    },
    loadingLayer: {
        zIndex: 2,
    },
    content: {
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    text: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
        marginTop: 6,
        letterSpacing: -0.1,
    },
});