/**
 * iOS 26 grouped-list row — colored icon tile, SF Rounded label, trailing
 * value / chevron / custom trailing. Matches the rest of the iOS 26 design
 * system used on the Profile tab (see ProfileRow for the selection variant).
 */
import { lightImpact } from '@/components/ui/haptics';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

// Shared row metrics
export const SETTINGS_ROW = {
    paddingVertical: 13,
    paddingHorizontal: 16,
    iconSize: 29,
    iconRadius: 7,
    iconGlyph: 16,
    gap: 12,
    /** Distance from row left edge to the start of the hairline. */
    hairlineIndent: 16 + 29 + 12, // paddingHorizontal + iconSize + gap = 57
} as const;

function useHairlineColor() {
    const isDark = useColorScheme() === 'dark';
    return isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(11, 13, 18, 0.09)';
}

export function RowHairline({ isLast }: { isLast?: boolean }) {
    const color = useHairlineColor();
    if (isLast) return null;
    return (
        <View
            style={{
                height: StyleSheet.hairlineWidth,
                marginLeft: SETTINGS_ROW.hairlineIndent,
                backgroundColor: color,
            }}
        />
    );
}

type IconGlyph = React.ComponentProps<typeof Ionicons>['name'];

type SettingsRowProps = {
    iconName: IconGlyph;
    iconColor: string;
    label: string;
    /** Simple string value shown at the right in secondary color. */
    value?: string;
    /** Custom trailing content replaces `value` + chevron when provided. */
    trailing?: React.ReactNode;
    /** Font family override for the value. Defaults to SF sans. */
    valueMono?: boolean;
    onPress?: () => void;
    onLongPress?: () => void;
    isLast?: boolean;
    accessibilityLabel?: string;
};

export function SettingsRow({
    iconName,
    iconColor,
    label,
    value,
    trailing,
    valueMono,
    onPress,
    onLongPress,
    isLast,
    accessibilityLabel,
}: SettingsRowProps) {
    const theme = useTheme();
    const showChevron = !!(onPress && !onLongPress && trailing === undefined && value === undefined);

    const body = (
        <View>
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: SETTINGS_ROW.paddingVertical,
                    paddingHorizontal: SETTINGS_ROW.paddingHorizontal,
                    gap: SETTINGS_ROW.gap,
                }}
            >
                {/* Colored icon tile — iOS 26 29×29 concentric rounded square */}
                <View
                    style={{
                        width: SETTINGS_ROW.iconSize,
                        height: SETTINGS_ROW.iconSize,
                        borderRadius: SETTINGS_ROW.iconRadius,
                        backgroundColor: iconColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Ionicons name={iconName} size={SETTINGS_ROW.iconGlyph} color="#ffffff" />
                </View>

                {/* Label — SF Rounded 17pt, primary text */}
                <Text
                    numberOfLines={1}
                    style={{
                        flex: 1,
                        fontSize: 17,
                        fontFamily: Fonts?.rounded,
                        fontWeight: '500',
                        color: theme.text,
                        letterSpacing: -0.3,
                    }}
                >
                    {label}
                </Text>

                {/* Trailing — explicit slot, or value text, or chevron */}
                {trailing !== undefined ? (
                    trailing
                ) : value !== undefined ? (
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 15,
                            fontFamily: valueMono ? Fonts?.mono : Fonts?.sans,
                            color: theme.textSecondary,
                            maxWidth: 200,
                            letterSpacing: -0.1,
                            fontVariant: valueMono ? ['tabular-nums'] : undefined,
                        }}
                    >
                        {value}
                    </Text>
                ) : null}

                {showChevron && (
                    <Ionicons name="chevron-forward" size={17} color={theme.textSecondary} />
                )}
            </View>
            <RowHairline isLast={isLast} />
        </View>
    );

    if (!onPress && !onLongPress) return body;

    return (
        <Pressable
            onPress={() => { lightImpact(); onPress?.(); }}
            onLongPress={onLongPress}
            delayLongPress={400}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        >
            {body}
        </Pressable>
    );
}
