import { lightImpact } from '@/components/ui/haptics';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

interface DevHeaderProps {
    onRefresh: () => void;
}

export function DevHeader({ onRefresh }: DevHeaderProps) {
    const theme = useTheme();

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 16 }}>
            <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}
            >
                <Ionicons name="chevron-back" size={20} color="#007AFF" />
                <Text style={{ color: '#007AFF', fontSize: 16 }}>Back</Text>
            </Pressable>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, fontFamily: Fonts?.rounded }}>
                Developer
            </Text>
            <Pressable
                onPress={() => { lightImpact(); onRefresh(); }}
                style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.6 : 1 })}
            >
                <Ionicons name="refresh" size={20} color="#007AFF" />
            </Pressable>
        </View>
    );
}
