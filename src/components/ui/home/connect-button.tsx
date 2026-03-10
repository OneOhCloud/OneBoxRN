import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// 让 SVG 组件支持动画
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 148;
const RADIUS = SIZE / 2;
const SVG_SIZE = SIZE * 2; // 给阴影留出足够的发光空间
const CENTER = SVG_SIZE / 2;
const APPLE_BLUE = '#007AFF';


interface ConnectButtonProps {
    connected: boolean;
    loading: boolean;
    onPress: () => void;
}

export function ConnectButton({ connected, loading, onPress }: ConnectButtonProps) {
    const theme = useTheme();
    const pressScale = useSharedValue(1);

    // ── 动画逻辑 ───────────────────────────────────────────

    // 按钮缩放动画
    const containerStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pressScale.value }],
    }));

    // 背景颜色动画 (使用 animatedProps 传给 SVG)
    const animatedCircleProps = useAnimatedProps(() => {
        return {
            fill: withTiming(connected ? APPLE_BLUE : theme.backgroundElement, {
                duration: 250,
            }),
        };
    });

    const textColor = connected ? '#ffffff' : theme.text;
    const label = loading ? '…' : connected ? i18n.t('connected') : i18n.t('connect');

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.animWrapper, containerStyle]}>
                {/* 使用 SVG 绘制背景，彻底解决 Android 多边形锯齿问题 */}
                <Svg height={SVG_SIZE} width={SVG_SIZE} style={styles.svgOverlay}>
                    <Defs>
                        <RadialGradient id="glow" cx="50%" cy="50%" rx="50%" ry="50%">
                            <Stop offset="0%" stopColor={APPLE_BLUE} stopOpacity="0.4" />
                            <Stop offset="100%" stopColor={APPLE_BLUE} stopOpacity="0" />
                        </RadialGradient>
                    </Defs>

                    {/* 模拟发光阴影 (仅在连接时显示) */}
                    {connected && (
                        <Circle
                            cx={CENTER}
                            cy={CENTER}
                            r={RADIUS + 24}
                            fill="url(#glow)"
                        />
                    )}

                    {/* 真正的圆形按钮背景 */}
                    <AnimatedCircle
                        cx={CENTER}
                        cy={CENTER}
                        r={RADIUS}
                        animatedProps={animatedCircleProps}
                    />
                </Svg>

                {/* 内容层 */}
                <Pressable
                    onPress={() => { mediumImpact(); onPress(); }}
                    onPressIn={() => { pressScale.value = withSpring(0.92); }}
                    onPressOut={() => { pressScale.value = withSpring(1); }}
                    disabled={loading}
                    style={styles.content}
                >
                    <Ionicons name="power" size={36} color={textColor} />
                    <ThemedText style={[styles.text, { color: textColor }]}>
                        {label}
                    </ThemedText>
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
    content: {
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1, // 确保内容在 SVG 之上
    },
    text: {
        fontSize: 14,
        fontWeight: '600',
        marginTop: 4,
    },
});