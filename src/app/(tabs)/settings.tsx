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
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Settings Row ────────────────────────────────────────────

type SettingsRowProps = {
    iconName: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    label: string;
    value?: string;
    onPress?: () => void;
    isLast?: boolean;
};

function SettingsRow({ iconName, iconColor, label, value, onPress, isLast = false }: SettingsRowProps) {
    const theme = useTheme();
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
                {onPress && (
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

    if (!onPress) return inner;
    return (
        <Pressable
            onPress={() => { lightImpact(); onPress(); }}
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
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const insets = {
        ...safeAreaInsets,
        bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    };

    const appVersion = Constants.expoConfig?.version ?? '\u2014';
    const coreVersion = ExpoOneBox.getLibBoxVersion() || '\u2014';

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

                    {/* About */}
                    <View>
                        <SectionLabel text={i18n.t('section_about')} />
                        <SettingsCard>
                            <SettingsRow
                                iconName="apps-outline"
                                iconColor="#007AFF"
                                label={i18n.t('app_version')}
                                value={appVersion}
                            />
                            <SettingsRow
                                iconName="server-outline"
                                iconColor="#5856D6"
                                label={i18n.t('libbox_version')}
                                value={coreVersion}
                            />
                            <SettingsRow
                                iconName="globe-outline"
                                iconColor="#34C759"
                                label={i18n.t('official_website')}
                                value="sing-box.net"
                                onPress={() => Linking.openURL('https://sing-box.net')}
                                isLast
                            />
                        </SettingsCard>
                    </View>

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
                </View>
                <View style={{ height: insets.bottom }} />
            </ScrollView>
        </View>
    );
}
