import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

interface ConnectButtonProps {
    connected: boolean;
    loading: boolean;
    onPress: () => void;
}

const SIZE = 148;
const APPLE_BLUE = '#007AFF';

/** Hero circular connect/disconnect button */
export function ConnectButton({ connected, loading, onPress }: ConnectButtonProps) {
    const theme = useTheme();

    // ── Press spring ─────────────────────────────────────────
    const pressScale = useSharedValue(1);

    const btnAnimStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pressScale.value }],
    }));

    const bgColor = connected ? APPLE_BLUE : theme.backgroundElement;
    const textColor = connected ? '#ffffff' : theme.text;
    const label = loading ? '…' : connected ? '已连接' : '连接';

    return (
        <View style={{ width: SIZE * 1.9, height: SIZE * 1.9, alignItems: 'center', justifyContent: 'center' }}>
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
                        shadowColor: connected ? APPLE_BLUE : '#000',
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: connected ? 0.75 : 0.12,
                        shadowRadius: connected ? 24 : 8,
                        elevation: connected ? 16 : 4,
                    }}
                >
                    <Ionicons name="power" size={36} color={textColor} />
                    <ThemedText style={{ fontSize: 14, fontWeight: '600', marginTop: 4, color: textColor }}>
                        {label}
                    </ThemedText>
                </Pressable>
            </Animated.View>
        </View>
    );
}
