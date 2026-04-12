import { ACCENT, ACCENT_LIGHT } from '@/components/ui/profiles/active-profile-card';
import { selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import React from 'react';
import { Pressable, Text, View, useColorScheme } from 'react-native';

const OPTIONS = [
    { labelKey: 'mode_rules', value: 'tun-rules' as const },
    { labelKey: 'mode_global', value: 'tun-global' as const },
];

// ─── iOS 26 segmented control ───────────────────────────────────────────────
// Rounded pill track (radius 14), thumb with soft glass shadow, blue-tinted
// label on active. Track uses silver-gray to fit the cool palette.
export function ModeSelector({ hideSectionLabel: _hideSectionLabel }: { hideSectionLabel?: boolean } = {}) {
    const theme = useTheme();
    const isDark = useColorScheme() === 'dark';
    const { mode, setMode } = useVpn();
    const accentBlue = isDark ? ACCENT : ACCENT_LIGHT;

    const trackColor = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(11, 13, 18, 0.06)';
    const thumbColor = isDark ? 'rgba(58, 62, 75, 0.95)' : '#FFFFFF';

    return (
        <View>
            <View
                style={{
                    flexDirection: 'row',
                    padding: 4,
                    backgroundColor: trackColor,
                    borderRadius: 14,
                    height: 44,
                }}
                accessibilityRole="tablist"
            >
                {OPTIONS.map((opt) => {
                    const active = mode === opt.value;
                    return (
                        <Pressable
                            key={opt.value}
                            onPress={() => { selectionChanged(); setMode(opt.value); }}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            style={{
                                flex: 1,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 11,
                                backgroundColor: active ? thumbColor : 'transparent',
                                ...(active
                                    ? {
                                          shadowColor: '#0B1628',
                                          shadowOffset: { width: 0, height: 3 },
                                          shadowOpacity: isDark ? 0.35 : 0.10,
                                          shadowRadius: 8,
                                          elevation: 2,
                                      }
                                    : null),
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 15,
                                    fontFamily: Fonts?.rounded,
                                    fontWeight: active ? '700' : '500',
                                    color: active ? accentBlue : theme.text,
                                    letterSpacing: -0.2,
                                }}
                            >
                                {i18n.t(opt.labelKey)}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            {/* Footer description — iOS 26 settings footer text */}
            <Text
                style={{
                    fontSize: 12,
                    fontFamily: Fonts?.sans,
                    color: theme.textSecondary,
                    marginTop: 10,
                    marginHorizontal: 4,
                    lineHeight: 16,
                }}
            >
                {i18n.t(mode === 'tun-rules' ? 'mode_desc_rules' : 'mode_desc_global')}
            </Text>
        </View>
    );
}
