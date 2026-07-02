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
     * Initial vertical offset (px) for the fadeDown variant.
     * The content springs back to 0 on focus.
     */
    dy?: number;
}

/**
 * Replays an entry animation every time its host tab screen becomes focused.
 *
 * Native tabs (iOS NativeTabs / Android Material3) keep each screen mounted
 * across switches, so Reanimated's `entering` prop only fires once per session.
 * We instead drive the shared values imperatively from `useFocusEffect`: reset
 * on blur, animate on focus — so each tab switch feels like the content is
 * landing, not just appearing.
 *
 * Two variants:
 * - `fade`     — 220ms linear opacity. Quiet, doesn't compete with live state.
 *                Recommended for the Home/VPN control tab.
 * - `fadeDown` — Opacity + translateY spring. More tactile; recommended for
 *                list-heavy tabs (Profiles, Settings).
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
            // On focus — play forwards.
            opacity.set(withTiming(1, { duration: variant === 'fade' ? 220 : 320 }));
            if (variant === 'fadeDown') {
                translateY.set(withSpring(0, { damping: 18, stiffness: 180, mass: 0.9 }));
            }

            // On blur — reset so the next focus re-plays.
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
