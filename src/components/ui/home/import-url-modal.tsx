import { ThemedText } from '@/components/themed-text';
import CameraQR from '@/components/ui/camera-qr';
import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ImportUrlModalProps {
    visible: boolean;
    onClose: () => void;
}

/** Page-sheet modal for importing a profile URL or scanning QR */
export function ImportUrlModal({ visible, onClose }: ImportUrlModalProps) {
    const theme = useTheme();
    const [url, setUrl] = useState('');
    const [cameraVisible, setCameraVisible] = useState(false);

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

    if (cameraVisible) {
        return (
            <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="pageSheet">
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <CameraQR
                        onHandleClose={() => {
                            setCameraVisible(false);
                        }}
                        onBeforeNavigate={() => {
                            setCameraVisible(false);
                            onClose();
                        }}
                    />
                </View>
            </Modal>
        );
    }

    return (
        <Modal
            visible={visible}
            onRequestClose={onClose}
            animationType="slide"
            presentationStyle="pageSheet"
        >
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
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
                    {/* URL Input */}
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

                    {/* Import Button */}
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

                    {/* Divider */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 }}>
                        <View style={{ flex: 1, height: 1, backgroundColor: theme.backgroundElement }} />
                        <ThemedText themeColor="textSecondary" style={{ fontSize: 13 }}>
                            {i18n.t('or')}
                        </ThemedText>
                        <View style={{ flex: 1, height: 1, backgroundColor: theme.backgroundElement }} />
                    </View>

                    {/* Scan QR Button */}
                    <Pressable
                        onPress={() => {
                            mediumImpact();
                            setCameraVisible(true);
                        }}
                        style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            backgroundColor: theme.backgroundElement,
                            paddingVertical: 14,
                            borderRadius: 16,
                            opacity: pressed ? 0.6 : 1,
                        })}
                    >
                        <Ionicons name="qr-code" size={20} color={theme.text} />
                        <ThemedText style={{ fontWeight: '600' }}>{i18n.t('scan_qr')}</ThemedText>
                    </Pressable>
                </View>

                {/* Bottom cancel button */}
                <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
                    <Pressable
                        onPress={onClose}
                        style={({ pressed }) => ({
                            alignItems: 'center',
                            paddingVertical: 16,
                            borderRadius: 16,
                            backgroundColor: theme.backgroundElement,
                            opacity: pressed ? 0.6 : 1,
                        })}
                    >
                        <ThemedText style={{ fontSize: 17, fontWeight: '500' }}>{i18n.t('cancel')}</ThemedText>
                    </Pressable>
                </View>
            </SafeAreaView>
            </KeyboardAvoidingView>
        </Modal>
    );
}
