import { ThemedText } from '@/components/themed-text';
import CameraQR from '@/components/ui/camera-qr';
import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

interface ImportUrlModalProps {
    visible: boolean;
    onClose: () => void;
}

/** 用于导入配置 URL 或扫描 QR 的全屏 modal */
export function ImportUrlModal({ visible, onClose }: ImportUrlModalProps) {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const [url, setUrl] = useState('');
    const [urlError, setUrlError] = useState('');
    const [cameraVisible, setCameraVisible] = useState(false);

    function handleImport() {
        const trimmed = url.trim();
        if (!trimmed.startsWith('https://')) {
            setUrlError(i18n.t('invalid_link_hint'));
            return;
        }
        setUrlError('');
        mediumImpact();
        onClose();
        setUrl('');
        router.push(`/config?data=${encodeURIComponent(btoa(trimmed))}`);
    }

    if (cameraVisible) {
        return (
            <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
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
            onDismiss={() => { setUrl(''); setUrlError(''); }}
            animationType="slide"
            presentationStyle="fullScreen"
            backdropColor={theme.background}
        >
            <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
                {/* 头部 */}
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
                        <ThemedText style={{ fontSize: 18, fontWeight: '600' }}>{i18n.t('import_profile')}</ThemedText>
                        <Pressable onPress={onClose} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                            <ThemedText style={{ color: '#007AFF', fontWeight: '500' }}>{i18n.t('cancel')}</ThemedText>
                        </Pressable>
                    </View>
                </View>

                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                        flexGrow: 1,
                        paddingHorizontal: 20,
                        paddingTop: 20,
                        paddingBottom: Math.max(16, insets.bottom),
                    }}
                    contentInsetAdjustmentBehavior="never"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    keyboardShouldPersistTaps="handled"
                    automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                    showsVerticalScrollIndicator={false}
                >
                    {/* 内容 */}
                    <View style={{ gap: 16 }}>
                        {/* URL 输入 */}
                        <TextInput
                            placeholder={i18n.t('url_placeholder')}
                            value={url}
                            onChangeText={(text) => { setUrl(text); if (urlError) setUrlError(''); }}
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

                        {urlError ? (
                            <Text style={{ fontSize: 13, color: '#FF3B30', marginTop: -8, paddingHorizontal: 4 }}>
                                {urlError}
                            </Text>
                        ) : null}

                        {/* 导入按钮 */}
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

                        {/* 分隔线 */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 }}>
                            <View style={{ flex: 1, height: 1, backgroundColor: theme.backgroundElement }} />
                            <ThemedText themeColor="textSecondary" style={{ fontSize: 13 }}>
                                {i18n.t('or')}
                            </ThemedText>
                            <View style={{ flex: 1, height: 1, backgroundColor: theme.backgroundElement }} />
                        </View>

                        {/* 扫描 QR 按钮 */}
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

                    <View style={{ flex: 1 }} />

                    {/* 底部取消按钮 */}
                    <View style={{ marginTop: 20 }}>
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
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}
