import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Image, Pressable, View } from 'react-native';
interface EmptyStateProps {
    onImportUrl: () => void;
}

/** Shown when no profile has been imported yet */
export function EmptyState({ onImportUrl }: EmptyStateProps) {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            {/* Icon */}
            <Image
                source={require('../../../../assets/images/icon.png')}
                style={{ width: 128, height: 128, borderRadius: 28, marginBottom: 24 }}
                resizeMode="contain"
            />

            {/* Text */}
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 8 }}>
                {i18n.t('empty_title')}
            </ThemedText>
            <ThemedText
                themeColor="textSecondary"
                style={{ textAlign: 'center', lineHeight: 22, marginBottom: 36 }}
            >
                {i18n.t('empty_desc')}
            </ThemedText>

            {/* Actions */}
            <View style={{ width: '100%', gap: 12 }}>
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
                    <ThemedText style={{ fontWeight: '600' }}>{i18n.t('import_subscription_link')}</ThemedText>
                </Pressable>

                <ThemedText
                    themeColor="textSecondary"
                    style={{ textAlign: 'center', lineHeight: 18, marginTop: 8 }}
                >
                    {i18n.t('only_singbox_links')}
                </ThemedText>
            </View>
        </View>
    );
}
