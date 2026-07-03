import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

type Variant = 'fade' | 'fadeDown';

interface TabFocusAnimatorProps {
    variant?: Variant;
    children: React.ReactNode;
    /**
     * fadeDown 变体的初始垂直偏移（px）。
     * 内容在获得焦点时 spring 回 0。
     */
    dy?: number;
}

/**
 * 每次宿主 tab 屏获得焦点时重放一次入场动画。
 *
 * Native tabs（iOS NativeTabs / Android Material3）在切换时保持各屏挂载，
 * 因此 Reanimated 的 `entering` 每次会话只触发一次。这里改为从 `useFocusEffect`
 * 命令式驱动 shared value：blur 时重置、focus 时播放 — 让每次切 tab 都像内容
 * 落位，而非凭空出现。
 *
 * 两种变体：
 * - `fade`     — 220ms 线性 opacity。安静，不与实时状态争夺注意力。
 *                推荐用于 Home/VPN 控制 tab。
 * - `fadeDown` — Opacity + translateY spring。更有触感；推荐用于列表密集的
 *                tab（Profiles、Settings）。
 */
export function TabFocusAnimator({
    variant = 'fade',
    children,
    dy = 10,
}: TabFocusAnimatorProps) {
    const opacity = useSharedValue(0);
    const translateY = useSharedValue(variant === 'fadeDown' ? dy : 0);

    useFocusEffect(
        useCallback(() => {
            // focus 时 — 正向播放。
            opacity.set(withTiming(1, { duration: variant === 'fade' ? 220 : 320 }));
            if (variant === 'fadeDown') {
                translateY.set(withSpring(0, { damping: 18, stiffness: 180, mass: 0.9 }));
            }

            // blur 时 — 重置，让下次 focus 重新播放。
            return () => {
                opacity.set(0);
                translateY.set(variant === 'fadeDown' ? dy : 0);
            };
        }, [variant, dy, opacity, translateY]),
    );

    const animatedStyle = useAnimatedStyle(() => ({
        flex: 1,
        opacity: opacity.value,
        transform: [{ translateY: translateY.value }],
    }));

    return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
