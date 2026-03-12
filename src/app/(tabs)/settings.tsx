/**
 * Settings Screen — app info, core version, official links, and developer tools.
 */
import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Settings Row ────────────────────────────────────────────

type SettingsRowProps = {
    iconName: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    label: string;
    value?: string;
    onPress?: () => void;
    onLongPress?: () => void;
    isLast?: boolean;
};

function SettingsRow({ iconName, iconColor, label, value, onPress, onLongPress, isLast = false }: SettingsRowProps) {
    const theme = useTheme();
    // 仅在有页面跳转/外部跳转时显示箭头
    const showChevron = !!(onPress && !onLongPress);
    const inner = (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}>
                <View
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        backgroundColor: iconColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Ionicons name={iconName} size={16} color="#fff" />
                </View>
                <ThemedText style={{ flex: 1, fontSize: 15, fontWeight: '400' }}>{label}</ThemedText>
                {value !== undefined && (
                    <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={1}
                        style={{ maxWidth: 180 }}
                    >
                        {value}
                    </ThemedText>
                )}
                {showChevron && (
                    <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                )}
            </View>
            {!isLast && (
                <View
                    style={{
                        height: 0.5,
                        backgroundColor: theme.textSecondary,
                        opacity: 0.15,
                        marginLeft: 44,
                    }}
                />
            )}
        </View>
    );

    if (!onPress && !onLongPress) return inner;
    return (
        <Pressable
            onPress={() => { lightImpact(); onPress && onPress(); }}
            onLongPress={() => { onLongPress && onLongPress(); }}
            delayLongPress={400}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
            {inner}
        </Pressable>
    );
}

// ─── Settings Card ───────────────────────────────────────────

function SettingsCard({ children }: { children: React.ReactNode }) {
    const theme = useTheme();
    return (
        <View
            style={{
                marginTop: 8,
                backgroundColor: theme.cardBackground,
                borderRadius: 16,
                paddingHorizontal: 16,
                borderWidth: 1,
                borderColor: theme.border,
            }}
        >
            {children}
        </View>
    );
}

// ─── Settings Screen ─────────────────────────────────────────

export default function SettingsScreen() {
    const [showBuild, setShowBuild] = React.useState(false);
    let versionDetail = '';
    if (Platform.OS === 'web') {
        versionDetail = `Build: ${Constants.expoConfig?.extra?.webBuildNumber ?? '\u2014'}`;
    } else if (Platform.OS === 'ios') {
        versionDetail = `Build: ${Constants.expoConfig?.ios?.buildNumber ?? '\u2014'}`;
    } else if (Platform.OS === 'android') {
        versionDetail = `Build: ${Constants.expoConfig?.android?.versionCode ?? '\u2014'}`;
    }

    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const insets = {
        ...safeAreaInsets,
        bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    };

    const appVersion = `${Constants.expoConfig?.version}`;
    const coreVersion = ExpoOneBox.getLibBoxVersion() || '\u2014';

    const getAppVersion = () => {
        if (showBuild && versionDetail) {
            return `${appVersion} (${versionDetail})`;
        }
        return appVersion;
    };

    return (
        <View
            className="flex-1"
            style={{
                backgroundColor: theme.background,
                paddingTop: Platform.OS === 'web' ? Spacing.six : insets.top,
                paddingLeft: insets.left,
                paddingRight: insets.right,
            }}
        >
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                <View className="flex-col px-5 gap-8">
                    <ThemedText type="subtitle">{i18n.t('settings_title')}</ThemedText>
                    {/* Tools */}
                    <View>
                        <SectionLabel text={i18n.t('section_tools')} />
                        <SettingsCard>
                            <SettingsRow
                                iconName="document-text-outline"
                                iconColor="#FF9500"
                                label={i18n.t('open_logs')}
                                onPress={() => router.push('/config/logs')}
                            />
                            <SettingsRow
                                iconName="code-slash-outline"
                                iconColor="#AF52DE"
                                label={i18n.t('view_config')}
                                onPress={() => router.push('/config/view-config')}
                                isLast
                            />
                        </SettingsCard>
                    </View>
                    {/* About */}
                    <View>
                        <SectionLabel text={i18n.t('section_about')} />
                        <SettingsCard>
                            <SettingsRow
                                iconName="globe-outline"
                                iconColor="#34C759"
                                label={i18n.t('official_website')}
                                value=""
                                onPress={() => Linking.openURL('https://sing-box.net')}

                            />

                            <SettingsRow
                                iconName="document-lock-outline"
                                iconColor="#FF3B30"
                                label={i18n.t('privacy_policy')}
                                value=""
                                onPress={() => Linking.openURL('https://sing-box.net/privacy')}

                            />
                            <SettingsRow
                                iconName="apps-outline"
                                iconColor="#007AFF"
                                label={i18n.t('app_version')}
                                value={getAppVersion()}
                                onPress={() => setShowBuild(false)}
                                onLongPress={() => setShowBuild(true)}
                            />
                            <SettingsRow
                                iconName="extension-puzzle-outline"
                                iconColor="#6b7280"
                                label={i18n.t('libbox_version')}
                                value={coreVersion}
                                isLast
                            />

                        </SettingsCard>
                    </View>


                </View>
                <View style={{ height: insets.bottom }} />
            </ScrollView>
        </View>
    );
}
