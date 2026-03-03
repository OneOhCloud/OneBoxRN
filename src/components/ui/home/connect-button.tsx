import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/use-theme';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

interface ConnectButtonProps {
    connected: boolean;
    loading: boolean;
    onPress: () => void;
}

const SIZE = 148;
const RING_COLOR = '#34C759';

/** Hero circular connect/disconnect button with pulse animation */
export function ConnectButton({ connected, loading, onPress }: ConnectButtonProps) {
    const theme = useTheme();

    // ── Pulse rings ──────────────────────────────────────────
    const ring1Scale = useSharedValue(1);
    const ring1Opacity = useSharedValue(0);
    const ring2Scale = useSharedValue(1);
    const ring2Opacity = useSharedValue(0);

    // ── Press spring ─────────────────────────────────────────
    const pressScale = useSharedValue(1);

    useEffect(() => {
        if (connected && !loading) {
            const DURATION = 8000;
            ring1Scale.value = withRepeat(
                withTiming(1.22, { duration: DURATION, easing: Easing.out(Easing.quad) }),
                -1, false
            );
            ring1Opacity.value = withRepeat(
                withTiming(0, { duration: DURATION, easing: Easing.in(Easing.quad) }),
                -1, false
            );
            ring1Opacity.value = 0.40;
            ring2Scale.value = withDelay(
                700,
                withRepeat(
                    withTiming(1.42, { duration: DURATION, easing: Easing.out(Easing.quad) }),
                    -1, false
                )
            );
            ring2Opacity.value = withDelay(
                700,
                withRepeat(
                    withTiming(0, { duration: DURATION, easing: Easing.in(Easing.quad) }),
                    -1, false
                )
            );
            ring2Opacity.value = 0.24;
        } else {
            ring1Scale.value = withTiming(1, { duration: 300 });
            ring1Opacity.value = withTiming(0, { duration: 300 });
            ring2Scale.value = withTiming(1, { duration: 300 });
            ring2Opacity.value = withTiming(0, { duration: 300 });
        }
    }, [connected, loading, ring1Opacity, ring1Scale, ring2Opacity, ring2Scale]);

    const ring1Style = useAnimatedStyle(() => ({
        transform: [{ scale: ring1Scale.value }],
        opacity: ring1Opacity.value,
    }));

    const ring2Style = useAnimatedStyle(() => ({
        transform: [{ scale: ring2Scale.value }],
        opacity: ring2Opacity.value,
    }));

    const btnAnimStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pressScale.value }],
    }));

    const bgColor = connected ? RING_COLOR : theme.backgroundElement;
    const textColor = connected ? '#ffffff' : theme.text;
    const label = loading ? '…' : connected ? '已连接' : '连接';

    return (
        <View style={{ width: SIZE * 1.9, height: SIZE * 1.9, alignItems: 'center', justifyContent: 'center' }}>
            {/* Outer pulse ring */}
            <Animated.View
                style={[{
                    position: 'absolute',
                    width: SIZE, height: SIZE,
                    borderRadius: SIZE / 2,
                    backgroundColor: RING_COLOR,
                }, ring2Style]}
            />
            {/* Inner pulse ring */}
            <Animated.View
                style={[{
                    position: 'absolute',
                    width: SIZE, height: SIZE,
                    borderRadius: SIZE / 2,
                    backgroundColor: RING_COLOR,
                }, ring1Style]}
            />

            {/* Main button */}
            <Animated.View style={btnAnimStyle}>
                <Pressable
                    onPress={() => { mediumImpact(); onPress(); }}
                    onPressIn={() => {
                        pressScale.value = withSpring(0.92, { damping: 14, stiffness: 280 });
                    }}
                    onPressOut={() => {
                        pressScale.value = withSpring(1, { damping: 14, stiffness: 280 });
                    }}
                    disabled={loading}
                    style={{
                        width: SIZE,
                        height: SIZE,
                        borderRadius: SIZE / 2,
                        backgroundColor: bgColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: connected ? RING_COLOR : '#000',
                        shadowOffset: { width: 0, height: connected ? 8 : 3 },
                        shadowOpacity: connected ? 0.45 : 0.12,
                        shadowRadius: connected ? 20 : 8,
                        elevation: connected ? 12 : 4,
                    }}
                >
                    <ThemedText style={{ fontSize: 36, lineHeight: 44, color: textColor }}>⏻</ThemedText>
                    <ThemedText style={{ fontSize: 14, fontWeight: '600', marginTop: 4, color: textColor }}>
                        {label}
                    </ThemedText>
                </Pressable>
            </Animated.View>
        </View>
    );
}
