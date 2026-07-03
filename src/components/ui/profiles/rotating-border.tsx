import React, { useEffect, useRef, useState } from 'react';
import Animated, {
    Easing,
    cancelAnimation,
    runOnJS,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

interface RotatingBorderProps {
    width: number;
    height: number;
    radius: number;
    active: boolean;
    color: string;
    /** 顺时针转满一圈的毫秒数。 */
    duration?: number;
}

/**
 * 科幻等离子扫掠边框。
 *
 * 所有图层的前缘对齐到同一个领先点，使密集的 core + spark 尖端位于彗尾最前端，
 * 弥散的 wake 拖在后面——契合真实彗星物理。
 *
 * 每个图层的偏移公式：
 *   strokeDashoffset = -(progress × perimeter) − (wakeDash − layerDash)
 *
 * 它把每个较短的图层向前推，使其末端与 wake 末端对齐，从而把亮度集中在前缘。
 */
export function RotatingBorder({
    width,
    height,
    radius,
    active,
    color,
    duration = 2200,
}: RotatingBorderProps) {
    const progress        = useSharedValue(0);
    const counterProgress = useSharedValue(0);
    const fadeOpacity     = useSharedValue(0);

    // 用三态机取代 visible 标志：状态转移在渲染期调整（guarded setState），
    // 因此 effect 内部不会触发 setState。
    type Phase = 'hidden' | 'active' | 'winding';
    const [phase, setPhase] = useState<Phase>(active ? 'active' : 'hidden');
    if (active && phase !== 'active') {
        setPhase('active');
    }
    if (!active && phase === 'active') {
        setPhase('winding');
    }

    const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startedAtRef = useRef<number>(0);

    // ── Geometry ─────────────────────────────────────────────────────────────
    // 无条件计算，确保 hooks 始终以相同顺序调用。
    const STROKE_W  = 1.5;
    const inset     = STROKE_W / 2;
    const innerW    = Math.max(0, width  - STROKE_W);
    const innerH    = Math.max(0, height - STROKE_W);
    const innerR    = Math.max(0, radius - inset);
    const perimeter = width > 0 && height > 0
        ? 2 * (innerW + innerH - 2 * innerR) + 2 * Math.PI * innerR
        : 0;

    const wake    = perimeter * 0.38;
    const plasma  = perimeter * 0.24;
    const glow    = perimeter * 0.16;
    const core    = perimeter * 0.16;
    const spark   = perimeter * 0.025;
    const counter = perimeter * 0.08;

    const gap = (d: number) => Math.max(0.0001, perimeter - d);

    // ── Animated props ────────────────────────────────────────────────────────
    // 每个图层的前缘 = progress × perimeter + wake（作为参考前缘）。
    // 把每个较短图层前移 (wake − layerDash)，使它们的末端对齐。
    const wakeProps    = useAnimatedProps(() => ({
        strokeDashoffset: -(progress.value * perimeter),
    }));
    const plasmaProps  = useAnimatedProps(() => ({
        strokeDashoffset: -(progress.value * perimeter) - (wake - plasma),
    }));
    const glowProps    = useAnimatedProps(() => ({
        strokeDashoffset: -(progress.value * perimeter) - (wake - glow),
    }));
    const coreProps    = useAnimatedProps(() => ({
        strokeDashoffset: -(progress.value * perimeter) - (wake - core),
    }));
    const sparkProps   = useAnimatedProps(() => ({
        strokeDashoffset: -(progress.value * perimeter) - (wake - spark),
    }));
    const counterProps = useAnimatedProps(() => ({
        strokeDashoffset: counterProgress.value * perimeter,
    }));
    const fadeStyle = useAnimatedStyle(() => ({
        opacity: fadeOpacity.value,
    }));

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }

        if (phase === 'active') {
            fadeOpacity.set(withTiming(1, { duration: 300 }));
            startedAtRef.current = Date.now();

            progress.set(0);
            progress.set(withRepeat(
                withTiming(1, { duration, easing: Easing.linear }),
                -1,
                false,
            ));

            counterProgress.set(0);
            counterProgress.set(withRepeat(
                withTiming(1, { duration: duration * 1.65, easing: Easing.linear }),
                -1,
                false,
            ));
            return;
        }

        if (phase !== 'winding') return;

        // 持续扫掠直到播满 MIN_REVOLUTIONS 圈，然后淡出。
        const MIN_REVOLUTIONS = 1.5;
        const elapsed = Date.now() - startedAtRef.current;
        const wait    = Math.max(0, duration * MIN_REVOLUTIONS - elapsed);
        stopTimerRef.current = setTimeout(() => {
            stopTimerRef.current = null;
            fadeOpacity.set(withTiming(0, { duration: 600 }, (finished) => {
                // worklet 完成回调（UI 线程）——此处 `.value` 才是受支持的访问
                // 方式，且该规则不会对它告警。
                if (finished) {
                    cancelAnimation(progress);
                    cancelAnimation(counterProgress);
                    progress.value        = 0;
                    counterProgress.value = 0;
                    runOnJS(setPhase)('hidden');
                }
            }));
        }, wait);
    }, [phase, duration, progress, counterProgress, fadeOpacity]);

    useEffect(() => {
        return () => {
            if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
            cancelAnimation(progress);
            cancelAnimation(counterProgress);
        };
    }, [progress, counterProgress]);

    if (phase === 'hidden' || width <= 0 || height <= 0) return null;

    const R = {
        x: inset, y: inset, width: innerW, height: innerH,
        rx: innerR, ry: innerR, fill: 'none',
    } as const;

    return (
        <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, fadeStyle]}
        >
        <Svg
            width={width}
            height={height}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
        >
            {/* 幽灵反向弧 */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.05} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${counter},${gap(counter)}`}
                animatedProps={counterProps}
            />

            {/* 能量尾迹——弥散的拖尾 */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.06} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${wake},${gap(wake)}`}
                animatedProps={wakeProps}
            />

            {/* 等离子拖尾 */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.15} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${plasma},${gap(plasma)}`}
                animatedProps={plasmaProps}
            />

            {/* 聚焦的光晕 */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.35} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${glow},${gap(glow)}`}
                animatedProps={glowProps}
            />

            {/* 清晰的核心线 */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.90} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${core},${gap(core)}`}
                animatedProps={coreProps}
            />

            {/* 深色 spark 尖端——满不透明度，最前缘 */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={1} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${spark},${gap(spark)}`}
                animatedProps={sparkProps}
            />
        </Svg>
        </Animated.View>
    );
}
