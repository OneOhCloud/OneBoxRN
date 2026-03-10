/**
 * Config Viewer — displays the current active sing-box configuration (read-only).
 * Accessible from Settings > Current Config.
 */
import i18n from '@/constants/language';
import { Spacing } from '@/constants/theme';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React from 'react';
import { FlatList, Platform, Pressable, Text, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export default function ViewConfigScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const [displayText, setDisplayText] = React.useState<string | null>(null);
    const [configLines, setConfigLines] = React.useState<string[]>([]);

    React.useEffect(() => {
        let startTime = Date.now();
        const text = SBConfig.getConfigContent();
        setDisplayText(text);
        if (text) {
            setConfigLines(text.split('\n'));
        }
        console.log(`Config content loaded in ${Date.now() - startTime}ms`);
    }, []);


    const handleCopy = async () => {
        if (!displayText) return;
        await Clipboard.setStringAsync(displayText);
        if (Platform.OS === 'android') {
            ToastAndroid.show(i18n.t('copied'), ToastAndroid.SHORT);
        }
    };

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: theme.background,
                paddingTop: safeAreaInsets.top || Spacing.six,
                paddingBottom: safeAreaInsets.bottom + Spacing.three,
                paddingLeft: safeAreaInsets.left,
                paddingRight: safeAreaInsets.right,
            }}
        >
            {/* Header */}
            <View
                className="flex-row items-center justify-between px-2 pb-4"

            >
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        opacity: pressed ? 0.6 : 1,
                    })}
                >
                    <Ionicons name="chevron-back" size={20} color="#007AFF" />
                    <Text style={{ color: '#007AFF', fontSize: 16, fontWeight: '400' }}>
                        {i18n.t('back')}
                    </Text>
                </Pressable>



                {displayText ? (
                    <Pressable
                        onPress={handleCopy}
                        style={({ pressed }) => ({
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            opacity: pressed ? 0.6 : 1,
                        })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="copy-outline" size={20} color="#007AFF" />
                    </Pressable>
                ) : (
                    <View style={{ width: 40 }} />
                )}
            </View>

            <View
                style={{
                    flex: 1,
                    marginHorizontal: 8,
                    borderRadius: 16,
                    overflow: 'hidden',
                    borderWidth: 1.5,
                    borderColor: theme.border ?? '#E5E5EA',
                    backgroundColor: theme.cardBackground ?? '#FFFFFF',
                }}
            >
                {!displayText ? (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: theme.textSecondary ?? '#636366', fontSize: 13 }}>
                            {i18n.t('config_empty')}
                        </Text>
                    </View>
                ) : (
                    <View style={{ flex: 1 }}>
                        <FlatList
                            data={configLines}
                            keyExtractor={(item, index) => `line-${index}`}
                            renderItem={({ item }) => (
                                <Text
                                    style={{
                                        fontFamily: MONO_FONT,
                                        fontSize: 12,
                                        color: theme.text ?? '#000000',
                                        paddingHorizontal: 12,
                                        paddingVertical: 2,
                                        lineHeight: 16,
                                    }}
                                >
                                    {item || ' '}
                                </Text>
                            )}
                            contentContainerStyle={{ flexGrow: 1, paddingVertical: 8 }}
                            showsVerticalScrollIndicator={true}
                        />
                    </View>
                )}
            </View>
        </View>
    );
}
