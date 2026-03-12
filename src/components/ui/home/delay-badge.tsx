import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Platform } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface DelayBadgeProps {
    delay: number;
    testing?: boolean;
}

export function DelayBadge({ delay, testing }: DelayBadgeProps) {
    const theme = useTheme();
    const animValue = useRef(new Animated.Value(1)).current;
    const prevDelay = useRef(delay);

    useEffect(() => {
        // Animate whenever delay changes to a real value (0→X or X→Y).
        // Skip the initial mount to avoid animating on first render.
        if (delay > 0 && delay !== prevDelay.current) {
            prevDelay.current = delay;
            animValue.setValue(0);
            Animated.spring(animValue, {
                toValue: 1,
                tension: 180,
                friction: 12,
                useNativeDriver: true,
            }).start();
        }
    }, [delay, animValue]);

    if (testing) {
        return (
            <ActivityIndicator
                size="small"
                color={theme.textSecondary}
                style={{ width: 32 }}
            />
        );
    }

    if (delay === 0) {
        return (
            <ThemedText style={{ fontSize: 12, fontFamily: MONO_FONT, color: theme.textSecondary }}>
                —
            </ThemedText>
        );
    }

    const color = delay < 200 ? '#3AAE60' : delay < 500 ? '#B8862A' : '#C04F4A';
    const scale = animValue.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.75, 1.08, 1] });

    return (
        <Animated.View
            style={{
                borderRadius: 6,
                paddingHorizontal: 7,
                paddingVertical: 2,
                opacity: animValue,
                transform: [{ scale }],
            }}
        >
            <ThemedText style={{ fontSize: 11, fontWeight: '600', color, fontFamily: MONO_FONT }}>
                {`${delay} ms`}
            </ThemedText>
        </Animated.View>
    );
}
