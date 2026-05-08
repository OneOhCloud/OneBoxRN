import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { InfoCard } from '@/components/ui/home/info-card';
import { SectionHeader } from '@/components/ui/ios26/section';
import { SettingsRow } from '@/components/ui/ios26/settings-row';
import { TabFocusAnimator } from '@/components/ui/tab-focus-animator';
import { useGlassSurface } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts, MaxContentWidth, TabScreenEdges } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen() {
    const { connected } = useVpn();
    const glass = useGlassSurface();
    const theme = useTheme();

    const [showBuild, setShowBuild] = React.useState(false);
    const aboutTapCount = useRef(0);
    const aboutTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleFooterTap() {
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

    const versionLine = showBuild
        ? `v${appVersion}(${buildVersion})-${coreVersion}`
        : `v${appVersion}-${coreVersion}`;

    return (
        // Top-level shell must stay structurally identical to index.tsx and
        // profile.tsx — any divergence causes sub-pixel drift on tab switches.
        <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            <SafeAreaView
                edges={TabScreenEdges}
                style={{
                    flex: 1,
                    maxWidth: MaxContentWidth,
                }}
            >
                <TabFocusAnimator variant="fadeDown">
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
                            flexGrow: 1,
                            paddingHorizontal: 16,
                            paddingTop: 4,
                            gap: 24,
                        }}
                    >
                        <View>

                            <View style={[glass, { paddingVertical: 4 }]}>
                                <InfoCard connected={connected} />
                            </View>
                        </View>

                        <View>
                            <SectionHeader label={i18n.t('section_about')} />
                            <View style={[glass, { paddingVertical: 4 }]}>
                                <SettingsRow
                                    iconName="globe-outline"
                                    iconColor="#007AFF"
                                    label={i18n.t('official_website')}
                                    onPress={() => Linking.openURL('https://sing-box.net')}
                                />
                                <SettingsRow
                                    iconName="shield-checkmark-outline"
                                    iconColor="#007AFF"
                                    label={i18n.t('privacy_policy')}
                                    onPress={() => Linking.openURL('https://sing-box.net/privacy')}
                                    isLast
                                />
                            </View>
                        </View>

                        <View>
                            <SectionHeader label={i18n.t('section_tools')} />
                            <View style={[glass, { paddingVertical: 4 }]}>
                                <SettingsRow
                                    iconName="document-text-outline"
                                    iconColor="#007AFF"
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

                        {/* Flex spacer pushes the version footer to the bottom of
                        the scroll area whenever content is shorter than the
                        viewport. Triple-tap opens the dev menu; long-press
                        toggles the build number. */}
                        <View style={{ flex: 1 }} />

                        <Pressable
                            onPress={handleFooterTap}
                            onLongPress={() => setShowBuild(v => !v)}
                            hitSlop={8}
                            style={({ pressed }) => ({
                                opacity: pressed ? 0.5 : 1,
                                paddingVertical: 12,
                                alignItems: 'center',
                            })}
                        >
                            <Text
                                style={{
                                    fontSize: 11,
                                    fontFamily: Fonts?.sans,
                                    fontWeight: '400',
                                    color: theme.textSecondary,
                                    opacity: 0.5,
                                    letterSpacing: 0.1,
                                    lineHeight: 16,
                                }}
                            >
                                {versionLine}
                            </Text>
                        </Pressable>
                    </ScrollView>
                </TabFocusAnimator>
            </SafeAreaView>
        </ThemedView>
    );
}
