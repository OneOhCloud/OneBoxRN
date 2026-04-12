/**
 * Settings Screen — system status, about, and tools.
 * iOS 26 Liquid Glass × blue/silver/gray/white palette.
 */
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { InfoCard } from '@/components/ui/home/info-card';
import { SectionHeader } from '@/components/ui/ios26/section';
import { SettingsRow } from '@/components/ui/ios26/settings-row';
import { useGlassSurface } from '@/components/ui/profiles/active-profile-card';
import i18n from '@/constants/language';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import ExpoOneBox from '@/modules/expo-onebox';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen() {
    const { connected } = useVpn();
    const glass = useGlassSurface();

    const [showBuild, setShowBuild] = React.useState(false);
    const aboutTapCount = useRef(0);
    const aboutTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleAboutTap() {
        aboutTapCount.current += 1;
        if (aboutTapTimer.current) clearTimeout(aboutTapTimer.current);
        if (aboutTapCount.current >= 3) {
            aboutTapCount.current = 0;
            router.push('/config/dev');
            return;
        }
        aboutTapTimer.current = setTimeout(() => { aboutTapCount.current = 0; }, 800);
    }

    const appVersion =
        Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
    const buildVersion =
        Platform.OS === 'web'
            ? String(Constants.expoConfig?.extra?.webBuildNumber ?? '—')
            : Application.nativeBuildVersion ?? String(Constants.nativeBuildVersion ?? '—');
    const coreVersion = ExpoOneBox.getLibBoxVersion() || '—';

    const versionValue = showBuild ? `${appVersion} (${i18n.t('build')} ${buildVersion})` : appVersion;

    return (
        // Top-level layout IDENTICAL to src/app/(tabs)/index.tsx and profile.tsx
        // so tab switches produce pixel-perfect vertical alignment across tabs.
        <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            <SafeAreaView
                style={{
                    flex: 1,
                    maxWidth: MaxContentWidth,
                    paddingBottom: BottomTabInset + Spacing.two,
                }}
            >
                {/* Masthead — SF Rounded 34pt/800 to match profile.tsx */}
                <View
                    style={{
                        paddingHorizontal: 20,
                        paddingTop: 12,
                        paddingBottom: 12,
                    }}
                >
                    <ThemedText
                        style={{
                            fontSize: 34,
                            fontFamily: Fonts?.rounded,
                            fontWeight: '800',
                            letterSpacing: -0.9,
                            lineHeight: 41,
                        }}
                    >
                        {i18n.t('settings_title')}
                    </ThemedText>
                </View>

                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        paddingHorizontal: 16,
                        paddingTop: 4,
                        gap: 24,
                    }}
                >
                    {/* ── System info ────────────────────────────────────── */}
                    <View>
                        <SectionHeader label={i18n.t('system_info')} />
                        <View style={[glass, { paddingVertical: 4 }]}>
                            <InfoCard connected={connected} />
                        </View>
                    </View>

                    {/* ── About (triple-tap on header opens dev menu) ────── */}
                    <View>
                        <Pressable onPress={handleAboutTap} hitSlop={8}>
                            <SectionHeader label={i18n.t('section_about')} />
                        </Pressable>
                        <View style={[glass, { paddingVertical: 4 }]}>
                            <SettingsRow
                                iconName="globe-outline"
                                iconColor="#32ADE6"
                                label={i18n.t('official_website')}
                                onPress={() => Linking.openURL('https://sing-box.net')}
                            />
                            <SettingsRow
                                iconName="shield-checkmark-outline"
                                iconColor="#5856D6"
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
                                iconColor="#3A82F7"
                                label={i18n.t('libbox_version')}
                                value={coreVersion}
                                valueMono
                                isLast
                            />
                        </View>
                    </View>

                    {/* ── Tools ──────────────────────────────────────────── */}
                    <View>
                        <SectionHeader label={i18n.t('section_tools')} />
                        <View style={[glass, { paddingVertical: 4 }]}>
                            <SettingsRow
                                iconName="document-text-outline"
                                iconColor="#5856D6"
                                label={i18n.t('open_logs')}
                                onPress={() => router.push('/config/logs')}
                            />
                            <SettingsRow
                                iconName="code-slash-outline"
                                iconColor="#007AFF"
                                label={i18n.t('view_config')}
                                onPress={() => router.push('/config/view-config')}
                                isLast
                            />
                        </View>
                    </View>
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}
