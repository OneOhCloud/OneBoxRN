import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import { ACCENT_LIGHT } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
// 下方的 spinStart 刻意用 SharedValue 而非 useRef：withTiming 的完成回调是
// worklet，一旦它读取 JS ref，Reanimated 会保存一份可序列化克隆，之后在 JS
// 侧修改 `.current` 就会触发
// "Tried to modify key 'current' of an object which has been already
// passed to a worklet" 警告。
import { AppState, AppStateStatus, Pressable, StyleSheet, View } from 'react-native';
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

    // 弧线不能直接绑定 loading：即便 loading 提前变为 false，也要让弧线至少
    // 完整转满一圈 360° 再停。用三态机建模这段收尾：状态转移在渲染期完成
    // （guarded setState），'winding' 只能从 'spinning' 进入，淡出结束后回到
    // 'hidden'。
    type ArcPhase = 'hidden' | 'spinning' | 'winding';
    const [arcPhase, setArcPhase] = useState<ArcPhase>(loading ? 'spinning' : 'hidden');
    if (loading && arcPhase !== 'spinning') {
        setArcPhase('spinning');
    }
    if (!loading && arcPhase === 'spinning') {
        setArcPhase('winding');
    }

    const spinStart = useSharedValue(0);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }

        if (arcPhase === 'spinning') {
            spinStart.set(Date.now());
            loadingProgress.set(0);
            loadingProgress.set(withRepeat(
                withTiming(1, { duration: SPIN_DURATION_MS, easing: Easing.linear }),
                -1,
                false,
            ));
            arcOpacity.set(withTiming(1, { duration: 300 }));
            return;
        }

        if (arcPhase === 'hidden') {
            arcOpacity.set(0);
            loadingProgress.set(0);
            return;
        }

        // 从起点至少转满 N 圈后再收尾，然后淡出。
        const elapsed = Date.now() - spinStart.get();
        const remaining = Math.max(0, SPIN_MIN_MS - elapsed);
        hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            arcOpacity.set(withTiming(0, { duration: 600 }, (finished) => {
                // worklet 完成回调（UI 线程）——此处 `.value` 才是受支持的访问方式。
                if (finished) {
                    cancelAnimation(loadingProgress);
                    loadingProgress.value = 0;
                    spinStart.value = 0;
                    runOnJS(setArcPhase)('hidden');
                }
            }));
        }, remaining);
    }, [arcPhase, loadingProgress, arcOpacity, spinStart]);

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
        fillProgress.set(withTiming(connected ? 1 : 0, { duration: 280 }));
    }, [connected, fillProgress]);

    // 回到前台时重新断言 connected 填充。蓝色遮罩的 fillOpacity 只存在于
    // Reanimated 的 UI 线程 animatedProps 中；经过一次后台周期后系统可能丢弃
    // 最后应用的 SVG 属性（Android surface 重新挂载）。由于恢复时 connected
    // 未变，上面的 effect 不会重新推送，遮罩被卡在 fillOpacity 0——白色底色
    // 透出来，按钮渲染成白色。恢复时直接跳到正确的稳态。
    // modify(forceUpdate=true) 会绕过 Reanimated 对相同值的短路（见 valueSetter），
    // 即使值未变也会重新应用原生节点；若本就正确，则视觉上是 no-op。
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next) => {
            if (appStateRef.current !== 'active' && next === 'active') {
                fillProgress.modify(() => {
                    'worklet';
                    return connected ? 1 : 0;
                }, true);
            }
            appStateRef.current = next;
        });
        return () => sub.remove();
    }, [fillProgress, connected]);

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

                    {/* 白色底色——始终可见 */}
                    <Circle
                        cx={CENTER}
                        cy={CENTER}
                        r={RADIUS}
                        fill={STANDBY_FILL}
                    />
                    {/* 蓝色遮罩——connected 时淡入 */}
                    <AnimatedCircle
                        cx={CENTER}
                        cy={CENTER}
                        r={RADIUS}
                        fill={ACCENT_LIGHT}
                        animatedProps={blueCircleProps}
                    />
                </Svg>

                {arcPhase !== 'hidden' && (
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
                    onPressIn={() => { pressScale.set(withSpring(0.92)); }}
                    onPressOut={() => { pressScale.set(withSpring(1)); }}
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