import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/use-theme';
import { Pressable, View } from 'react-native';

interface EmptyStateProps {
    onScanQR: () => void;
    onImportUrl: () => void;
}

/** Shown when no subscription config has been imported yet */
export function EmptyState({ onScanQR, onImportUrl }: EmptyStateProps) {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            {/* Icon */}
            <View
                style={{
                    width: 88,
                    height: 88,
                    borderRadius: 44,
                    backgroundColor: theme.backgroundElement,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 24,
                }}
            >
                <ThemedText style={{ fontSize: 40, lineHeight: 48 }}>🔒</ThemedText>
            </View>

            {/* Text */}
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 8 }}>
                开始使用
            </ThemedText>
            <ThemedText
                themeColor="textSecondary"
                style={{ textAlign: 'center', lineHeight: 22, marginBottom: 36 }}
            >
                导入订阅配置以开始使用
            </ThemedText>

            {/* Actions */}
            <View style={{ width: '100%', gap: 12 }}>
                <Pressable
                    onPress={() => { lightImpact(); onScanQR(); }}
                    style={({ pressed }) => ({
                        backgroundColor: '#007AFF',
                        paddingVertical: 14,
                        borderRadius: 16,
                        alignItems: 'center',
                        opacity: pressed ? 0.8 : 1,
                    })}
                >
                    <ThemedText style={{ color: '#fff', fontWeight: '600' }}>扫描二维码</ThemedText>
                </Pressable>
                <Pressable
                    onPress={() => { lightImpact(); onImportUrl(); }}
                    style={({ pressed }) => ({
                        backgroundColor: theme.backgroundElement,
                        paddingVertical: 14,
                        borderRadius: 16,
                        alignItems: 'center',
                        opacity: pressed ? 0.8 : 1,
                    })}
                >
                    <ThemedText style={{ fontWeight: '600' }}>导入订阅链接</ThemedText>
                </Pressable>
            </View>
        </View>
    );
}
