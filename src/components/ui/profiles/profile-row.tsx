import i18n from '@/constants/language';
import { Fonts, TabularNums } from '@/constants/theme';
import { Profile } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { mediumImpact } from '@/components/ui/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtBytes } from '@/utils';
import { ALERT, useAccentBlue, useHairlineColor, useSilver } from '@/constants/ios26-palette';

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
    onActivate: () => void;
    onDelete: () => void;
}) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    const accentBlue = useAccentBlue();
    const silver = useSilver();

    const hasTraffic = sub.totalTraffic > 0;
    const pct = hasTraffic
        ? Math.min((sub.usedTraffic / sub.totalTraffic) * 100, 100)
        : 0;

    const metaText = hasTraffic
        ? `${fmtBytes(sub.usedTraffic)} · ${Math.round(pct)}% ${i18n.t('traffic_used')}`
        : i18n.t('sub_empty_desc');

    const handlePress = () => {
        mediumImpact();
        if (editMode) onDelete();
        else onActivate();
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
            <View style={{ width: 28, alignItems: 'center', justifyContent: 'center' }}>
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
                            ...Platform.select({
                                ios: {
                                    shadowColor: accentBlue,
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 8,
                                },
                                default: null,
                            }),
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
                        fontVariant: TabularNums,
                        marginTop: 2,
                    }}
                >
                    {metaText}
                </Text>
            </View>
        </Pressable>
    );
}

export function ImportRow({
    onPress,
    isLast,
}: {
    onPress: () => void;
    isLast?: boolean;
}) {
    const hairline = useHairlineColor();
    const accentBlue = useAccentBlue();

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
            <View style={{ width: 28, alignItems: 'center', justifyContent: 'center' }}>
                <View
                    style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: `${accentBlue}1E`,
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
                    {i18n.t('import_profile')}
                </Text>
            </View>
        </Pressable>
    );
}
