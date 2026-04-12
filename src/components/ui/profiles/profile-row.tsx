import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { Profile } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { mediumImpact } from '@/components/ui/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { fmtBytes } from '@/components/ui/home/profile-info-card';
import { ACCENT, ACCENT_LIGHT, ALERT, SILVER_DARK, SILVER_LIGHT } from './active-profile-card';

// ─── Hairline separator token ──────────────────────────────────────────────
function useHairline() {
    const isDark = useColorScheme() === 'dark';
    return isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(11, 13, 18, 0.09)';
}

// ─── Profile row (iOS 26 grouped-inset style with filled-blue check) ────────
// Layout:  [ leading indicator 28pt ] [ name · meta ] [ trailing trash/chevron ]
// Active  → filled blue checkmark pill + concentric radius
// Inactive → silver hollow circle (quiet chrome)
export function ProfileRow({
    sub,
    isActive,
    isLast,
    editMode,
    onActivate,
    onDelete,
}: {
    sub: Profile;
    isActive: boolean;
    isLast?: boolean;
    editMode?: boolean;
    /** @deprecated retained for backward compat */
    isFirst?: boolean;
    onActivate: () => void;
    onDelete: () => void;
}) {
    const theme = useTheme();
    const isDark = useColorScheme() === 'dark';
    const hairline = useHairline();
    const accentBlue = isDark ? ACCENT : ACCENT_LIGHT;
    const silver = isDark ? SILVER_DARK : SILVER_LIGHT;

    const hasTraffic = sub.totalTraffic > 0;
    const pct = hasTraffic
        ? Math.min((sub.usedTraffic / sub.totalTraffic) * 100, 100)
        : 0;

    const metaText = hasTraffic
        ? `${fmtBytes(sub.usedTraffic)} · ${Math.round(pct)}% ${i18n.t('traffic_used')}`
        : i18n.t('sub_empty_desc');

    const handlePress = () => {
        mediumImpact();
        if (editMode) {
            onDelete();
        } else {
            onActivate();
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => ({
                opacity: pressed ? 0.55 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 16,
                gap: 14,
            })}
        >
            {/* Leading indicator — always same footprint (28pt gutter) */}
            <View
                style={{
                    width: 28,
                    height: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {editMode ? (
                    <View
                        style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: ALERT,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <View
                            style={{
                                width: 12,
                                height: 2,
                                backgroundColor: '#ffffff',
                                borderRadius: 1,
                            }}
                        />
                    </View>
                ) : isActive ? (
                    <View
                        style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: accentBlue,
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: accentBlue,
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.35,
                            shadowRadius: 8,
                        }}
                    >
                        <Ionicons name="checkmark" size={15} color="#ffffff" />
                    </View>
                ) : (
                    <View
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            borderWidth: 1.5,
                            borderColor: silver,
                        }}
                    />
                )}
            </View>

            {/* Content column with hairline separator at bottom */}
            <View
                style={{
                    flex: 1,
                    paddingRight: 4,
                    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: hairline,
                    paddingBottom: isLast ? 0 : 14,
                    marginBottom: isLast ? 0 : -14,
                }}
            >
                <Text
                    numberOfLines={1}
                    style={{
                        fontSize: 17,
                        fontFamily: Fonts?.rounded,
                        fontWeight: isActive ? '700' : '600',
                        color: theme.text,
                        letterSpacing: -0.3,
                        lineHeight: 22,
                    }}
                >
                    {sub.name}
                </Text>
                <Text
                    numberOfLines={1}
                    style={{
                        fontSize: 12,
                        fontFamily: Fonts?.sans,
                        color: theme.textSecondary,
                        fontVariant: ['tabular-nums'],
                        marginTop: 2,
                    }}
                >
                    {metaText}
                </Text>
            </View>
        </Pressable>
    );
}

// ─── Import row — iOS 26 "Add" pattern with tinted blue symbol ──────────────
export function ImportRow({
    onPress,
    isLast,
}: {
    onPress: () => void;
    isLast?: boolean;
}) {
    const isDark = useColorScheme() === 'dark';
    const hairline = useHairline();
    const accentBlue = isDark ? ACCENT : ACCENT_LIGHT;

    return (
        <Pressable
            onPress={() => { mediumImpact(); onPress(); }}
            style={({ pressed }) => ({
                opacity: pressed ? 0.55 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 16,
                gap: 14,
            })}
        >
            {/* Leading — tinted blue plus pill, same footprint as check */}
            <View
                style={{
                    width: 28,
                    height: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <View
                    style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: isDark
                            ? `${accentBlue}26`
                            : `${accentBlue}1C`,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Ionicons name="add" size={18} color={accentBlue} />
                </View>
            </View>

            <View
                style={{
                    flex: 1,
                    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: hairline,
                    paddingBottom: isLast ? 0 : 14,
                    marginBottom: isLast ? 0 : -14,
                }}
            >
                <Text
                    style={{
                        fontSize: 17,
                        fontFamily: Fonts?.rounded,
                        fontWeight: '600',
                        color: accentBlue,
                        letterSpacing: -0.3,
                        lineHeight: 22,
                    }}
                >
                    {i18n.t('import_subscription')}
                </Text>
            </View>
        </Pressable>
    );
}
