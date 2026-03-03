import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Platform, View } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface DelayBadgeProps {
    delay: number;
}

export function DelayBadge({ delay }: DelayBadgeProps) {
    const theme = useTheme();

    if (delay === 0) {
        return (
            <ThemedText style={{ fontSize: 12, fontFamily: MONO_FONT, color: theme.textSecondary }}>
                —
            </ThemedText>
        );
    }

    const color = delay < 200 ? '#3AAE60' : delay < 500 ? '#B8862A' : '#C04F4A';
    const bg = delay < 200 ? '#3AAE600D' : delay < 500 ? '#B8862A0D' : '#C04F4A0D';

    return (
        <View style={{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: bg }}>
            <ThemedText style={{ fontSize: 11, fontWeight: '600', color, fontFamily: MONO_FONT }}>
                {`${delay} ms`}
            </ThemedText>
        </View>
    );
}
