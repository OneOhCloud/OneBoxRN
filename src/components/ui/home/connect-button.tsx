import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/use-theme';
import { Pressable } from 'react-native';

interface ConnectButtonProps {
    connected: boolean;
    loading: boolean;
    onPress: () => void;
}

const SIZE = 144;

/** Hero circular connect/disconnect button */
export function ConnectButton({ connected, loading, onPress }: ConnectButtonProps) {
    const theme = useTheme();
    const bgColor = connected ? '#34C759' : theme.backgroundElement;
    const textColor = connected ? '#ffffff' : theme.text;
    const label = loading ? '...' : connected ? '已连接' : '连接';

    return (
        <Pressable
            onPress={() => { mediumImpact(); onPress(); }}
            disabled={loading}
            style={({ pressed }) => ({
                width: SIZE,
                height: SIZE,
                borderRadius: SIZE / 2,
                backgroundColor: bgColor,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || loading ? 0.75 : 1,
            })}
        >
            <ThemedText style={{ fontSize: 36, lineHeight: 44, color: textColor }}>⏻</ThemedText>
            <ThemedText style={{ fontSize: 14, fontWeight: '600', marginTop: 4, color: textColor }}>
                {label}
            </ThemedText>
        </Pressable>
    );
}
