import { ThemedText } from '@/components/themed-text';
import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ImportUrlModalProps {
    visible: boolean;
    onClose: () => void;
}

/** Page-sheet modal for importing a subscription URL */
export function ImportUrlModal({ visible, onClose }: ImportUrlModalProps) {
    const theme = useTheme();
    const [url, setUrl] = useState('');

    function handleImport() {
        const trimmed = url.trim();
        if (!trimmed.startsWith('https://')) {
            Alert.alert(i18n.t('invalid_link'), i18n.t('invalid_link_hint'));
            return;
        }
        mediumImpact();
        onClose();
        setUrl('');
        router.push(`/config?data=${encodeURIComponent(btoa(trimmed))}`);
    }

    return (
        <Modal
            visible={visible}
            onRequestClose={onClose}
            animationType="slide"
            presentationStyle="pageSheet"
        >
            <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
                {/* Header */}
                <View
                    style={{
                        paddingTop: 20,
                        paddingBottom: 20,
                        paddingHorizontal: 20,
                        borderBottomWidth: 0.5,
                        borderBottomColor: theme.backgroundElement,
                    }}
                >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <ThemedText style={{ fontSize: 18, fontWeight: '600' }}>{i18n.t('import_subscription')}</ThemedText>
                        <Pressable onPress={onClose} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                            <ThemedText style={{ color: '#007AFF', fontWeight: '500' }}>{i18n.t('cancel')}</ThemedText>
                        </Pressable>
                    </View>
                </View>

                {/* Content */}
                <View style={{ flex: 1, padding: 20, gap: 16 }}>
                    <TextInput
                        placeholder={i18n.t('url_placeholder')}
                        value={url}
                        onChangeText={setUrl}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="go"
                        autoFocus
                        onSubmitEditing={handleImport}
                        placeholderTextColor="#8E8E93"
                        style={{
                            fontSize: 16,
                            backgroundColor: theme.backgroundElement,
                            color: theme.text,
                            borderRadius: 16,
                            paddingHorizontal: 16,
                            paddingVertical: 14,
                        }}
                    />
                    <Pressable
                        onPress={handleImport}
                        style={({ pressed }) => ({
                            backgroundColor: '#007AFF',
                            paddingVertical: 14,
                            borderRadius: 16,
                            alignItems: 'center',
                            opacity: pressed ? 0.8 : 1,
                        })}
                    >
                        <ThemedText style={{ color: '#fff', fontWeight: '600' }}>{i18n.t('import')}</ThemedText>
                    </Pressable>
                </View>
            </SafeAreaView>
        </Modal>
    );
}
