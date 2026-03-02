import { ThemedText } from '@/components/themed-text';
import { View } from 'react-native';

interface StatusBadgeProps {
    connected: boolean;
    loading: boolean;
}

/** Small status indicator pill: dot + label */
export function StatusBadge({ connected, loading }: StatusBadgeProps) {
    const dotColor = loading ? '#FF9F0A' : connected ? '#34C759' : '#8E8E93';
    const label = loading ? '处理中' : connected ? '已连接' : '未连接';

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
            <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
        </View>
    );
}
