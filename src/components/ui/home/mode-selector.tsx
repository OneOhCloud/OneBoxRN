import { ThemedText } from '@/components/themed-text';
import { selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { Pressable, Text, View } from 'react-native';

const OPTIONS = [
    { labelKey: 'mode_rules', value: 'tun-rules' as const },
    { labelKey: 'mode_global', value: 'tun-global' as const },
];

/** Segmented control for routing mode: rules / global */
export function ModeSelector({ hideSectionLabel }: { hideSectionLabel?: boolean } = {}) {
    const theme = useTheme();
    const { mode, setMode: onChange } = useVpn();
    return (
        <View>
            {!hideSectionLabel && (
                <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={{ marginBottom: 8, paddingHorizontal: 4 }}
                >
                    {i18n.t('routing_mode')}
                </ThemedText>
            )}
            <View
                style={{
                    flexDirection: 'row',
                    borderRadius: 16,
                    padding: 4,
                    gap: 2,
                    backgroundColor: theme.glassBackground,
                    borderWidth: 0.5,
                    borderColor: theme.glassBorder,
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
                                backgroundColor: active ? '#007AFF' : undefined,
                            }}
                        >
                            {active ? (
                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>
                                    {i18n.t(opt.labelKey)}
                                </Text>
                            ) : (
                                <ThemedText style={{ fontSize: 14, fontWeight: '400' }}>
                                    {i18n.t(opt.labelKey)}
                                </ThemedText>
                            )}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}
