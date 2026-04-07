/**
 * Settings Screen — system status, traffic stats, tools, and about.
 */
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { lightImpact } from '@/components/ui/haptics';
import { InfoCard } from '@/components/ui/home/info-card';
import TrafficCard, { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Card shell ───────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
    const theme = useTheme();
    return (
        <View style={{ backgroundColor: theme.cardBackground, borderRadius: 14, paddingHorizontal: 16, overflow: 'hidden' }}>
            {children}
        </View>
    );
}

// ─── Settings row ─────────────────────────────────────────────────────────────

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
    const showChevron = !!(onPress && !onLongPress);
    const content = (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}>
                <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: iconColor, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={iconName} size={16} color="#fff" />
                </View>
                <ThemedText style={{ flex: 1, fontSize: 15 }}>{label}</ThemedText>
                {value !== undefined && (
                    <ThemedText themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 13, maxWidth: 180 }}>
                        {value}
                    </ThemedText>
                )}
                {showChevron && <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />}
            </View>
            {!isLast && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 44 }} />}
        </View>
    );

    if (!onPress && !onLongPress) return content;
    return (
        <Pressable
            onPress={() => { lightImpact(); onPress?.(); }}
            onLongPress={() => onLongPress?.()}
            delayLongPress={400}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
            {content}
        </Pressable>
    );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
    const theme = useTheme();
    const { connected, traffic } = useVpn();

    const [showBuild, setShowBuild] = React.useState(false);
    const aboutTapCount = useRef(0);
    const aboutTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleAboutTap() {
        aboutTapCount.current += 1;
        if (aboutTapTimer.current) clearTimeout(aboutTapTimer.current);
        if (aboutTapCount.current >= 3) {
            aboutTapCount.current = 0;
            lightImpact();
            router.push('/config/dev');
            return;
        }
        aboutTapTimer.current = setTimeout(() => { aboutTapCount.current = 0; }, 800);
    }

    const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
    const buildVersion = Platform.OS === 'web'
        ? String(Constants.expoConfig?.extra?.webBuildNumber ?? '—')
        : Application.nativeBuildVersion ?? String(Constants.nativeBuildVersion ?? '—');
    const coreVersion = ExpoOneBox.getLibBoxVersion() || '—';

    const versionValue = showBuild ? `${appVersion} (${i18n.t('build')} ${buildVersion})` : appVersion;

    return (
        <ThemedView style={{ flex: 1 }}>
            <SafeAreaView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
                <View style={{ flex: 1, maxWidth: MaxContentWidth }}>
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{
                            paddingHorizontal: 20,
                            paddingTop: 8,
                            paddingBottom: BottomTabInset + Spacing.three,
                            gap: 20,
                        }}
                    >
                        {/* Page title */}
                        <ThemedText style={{ fontSize: 28, fontWeight: '700', fontFamily: Fonts?.rounded, letterSpacing: -0.5, lineHeight: 36 }}>
                            {i18n.t('settings_title')}
                        </ThemedText>

                        {/* System Status */}
                        <View>
                            <SectionLabel text={i18n.t('system_info')} />
                            <Card>
                                <InfoCard connected={connected} />
                            </Card>
                        </View>

                        {/* Tools */}
                        <View>
                            <SectionLabel text={i18n.t('section_tools')} />
                            <Card>
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
                            </Card>
                        </View>

                        {/* About */}
                        <View>
                            <Pressable onPress={handleAboutTap} hitSlop={8}>
                                <SectionLabel text={i18n.t('section_about')} />
                            </Pressable>
                            <Card>
                                <SettingsRow
                                    iconName="globe-outline"
                                    iconColor="#34C759"
                                    label={i18n.t('official_website')}
                                    onPress={() => Linking.openURL('https://sing-box.net')}
                                />
                                <SettingsRow
                                    iconName="document-lock-outline"
                                    iconColor="#FF3B30"
                                    label={i18n.t('privacy_policy')}
                                    onPress={() => Linking.openURL('https://sing-box.net/privacy')}
                                />
                                <SettingsRow
                                    iconName="apps-outline"
                                    iconColor="#007AFF"
                                    label={i18n.t('app_version')}
                                    value={versionValue}
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
                            </Card>
                        </View>

                        {/* Traffic Stats — at the bottom, owns its own backgroundElement card */}
                        <View>
                            <SectionLabel text={i18n.t('traffic_stats')} />
                            <TrafficCard traffic={traffic} />
                        </View>
                    </ScrollView>
                </View>
            </SafeAreaView>
        </ThemedView>
    );
}
