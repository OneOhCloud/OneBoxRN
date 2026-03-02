import { ThemedText } from '@/components/themed-text';
import { selectionChanged } from '@/components/ui/haptics';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { Pressable, View } from 'react-native';

const OPTIONS = [
    { label: '规则路由', value: 'tun-rules' as const },
    { label: '全局代理', value: 'tun-global' as const },
];

/** Segmented control for routing mode: rules / global */
export function ModeSelector() {
    const theme = useTheme();
    const { mode, setMode: onChange } = useVpn();

    return (
        <View>
            <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginBottom: 8, paddingHorizontal: 4 }}
            >
                路由模式
            </ThemedText>
            <View
                style={{
                    flexDirection: 'row',
                    borderRadius: 16,
                    padding: 4,
                    gap: 2,
                    backgroundColor: theme.backgroundElement,
                }}
            >
                {OPTIONS.map((opt) => {
                    const active = mode === opt.value;
                    return (
                        <Pressable
                            key={opt.value}
                            onPress={() => { selectionChanged(); onChange(opt.value); }}
                            style={{
                                flex: 1,
                                alignItems: 'center',
                                paddingVertical: 10,
                                borderRadius: 12,
                                backgroundColor: active ? theme.background : undefined,
                            }}
                        >
                            <ThemedText style={{ fontSize: 14, fontWeight: active ? '600' : '400' }}>
                                {opt.label}
                            </ThemedText>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}
