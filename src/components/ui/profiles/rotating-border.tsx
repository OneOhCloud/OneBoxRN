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
    /** Milliseconds per full clockwise revolution. */
    duration?: number;
}

/**
 * Sci-fi plasma sweep border.
 *
 * All layers' FRONT EDGES align at the same leading point so the dense
 * core + spark tip sit at the very front of the comet, with the diffuse
 * wake trailing behind — matching real comet physics.
 *
 * Offset formula per layer:
 *   strokeDashoffset = -(progress × perimeter) − (wakeDash − layerDash)
 *
 * This shifts each shorter layer FORWARD so its end aligns with the
 * wake's end, concentrating brightness at the leading edge.
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

    // Three-phase machine replaces the visible flag: transitions are adjusted
    // during render (guarded setState), so no setState runs inside the effect.
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
    // Computed unconditionally so hooks are always called in the same order.
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
    // Each layer's front edge = progress × perimeter + wake (the reference front).
    // Shift each shorter layer forward by (wake − layerDash) so their ends align.
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

        // Keep sweeping until MIN_REVOLUTIONS have played, then fade out.
        const MIN_REVOLUTIONS = 1.5;
        const elapsed = Date.now() - startedAtRef.current;
        const wait    = Math.max(0, duration * MIN_REVOLUTIONS - elapsed);
        stopTimerRef.current = setTimeout(() => {
            stopTimerRef.current = null;
            fadeOpacity.set(withTiming(0, { duration: 600 }, (finished) => {
                // Worklet completion callback (UI thread) — `.value` is the
                // supported accessor here, and the rule does not flag it.
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
            {/* Ghost counter-arc */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.05} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${counter},${gap(counter)}`}
                animatedProps={counterProps}
            />

            {/* Energy wake — diffuse tail */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.06} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${wake},${gap(wake)}`}
                animatedProps={wakeProps}
            />

            {/* Plasma trail */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.15} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${plasma},${gap(plasma)}`}
                animatedProps={plasmaProps}
            />

            {/* Focused glow halo */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.35} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${glow},${gap(glow)}`}
                animatedProps={glowProps}
            />

            {/* Crisp core line */}
            <AnimatedRect
                {...R} stroke={color} strokeOpacity={0.90} strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray={`${core},${gap(core)}`}
                animatedProps={coreProps}
            />

            {/* Deep color spark tip — full opacity, front leading edge */}
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
