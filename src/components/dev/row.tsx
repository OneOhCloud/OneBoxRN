import { lightImpact } from '@/components/ui/haptics';
import { useHairlineColor } from '@/constants/ios26-palette';
import { Fonts, TabularNums } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type IconGlyph = React.ComponentProps<typeof Ionicons>['name'];

interface RowProps {
    label: string;
    value?: string;
    valueColor?: string;
    valueMono?: boolean;
    /** Optional leading icon square (SettingsRow-style). */
    iconName?: IconGlyph;
    iconColor?: string;
    /** Optional secondary line under the value. */
    caption?: string;
    /** Custom trailing replaces the default value + chevron. */
    trailing?: React.ReactNode;
    onPress?: () => void;
    onLongPress?: () => void;
    isLast?: boolean;
}

/**
 * iOS 26 list row used across the developer tools screen.
 * Typographic scale matches `SettingsRow` so dev pages feel cohesive with the
 * Settings / Profiles tabs. Values default to monospaced tabular numerals —
 * dev surfaces are overwhelmingly numeric — but can be disabled per-row.
 */
export function Row({
    label,
    value,
    valueColor,
    valueMono = true,
    iconName,
    iconColor,
    caption,
    trailing,
    onPress,
    onLongPress,
    isLast,
}: RowProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    const hairlineIndent = iconName ? 16 + 29 + 12 : 16;
    const showChevron = !!onPress && trailing === undefined && value === undefined;

    const body = (
        <>
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 13,
                    paddingHorizontal: 16,
                    gap: 12,
                }}
            >
                {iconName ? (
                    <View
                        style={{
                            width: 29,
                            height: 29,
                            borderRadius: 7,
                            backgroundColor: iconColor ?? '#8E8E93',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Ionicons name={iconName} size={16} color="#ffffff" />
                    </View>
                ) : null}

                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 17,
                            fontFamily: Fonts?.rounded,
                            fontWeight: '500',
                            color: theme.text,
                            letterSpacing: -0.3,
                        }}
                    >
                        {label}
                    </Text>
                    {caption ? (
                        <Text
                            numberOfLines={2}
                            style={{
                                fontSize: 12,
                                fontFamily: Fonts?.sans,
                                color: theme.textSecondary,
                                marginTop: 2,
                                letterSpacing: -0.05,
                            }}
                        >
                            {caption}
                        </Text>
                    ) : null}
                </View>

                {trailing !== undefined ? (
                    trailing
                ) : value !== undefined ? (
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 15,
                            fontFamily: valueMono ? Fonts?.mono : Fonts?.sans,
                            color: valueColor ?? theme.textSecondary,
                            maxWidth: 200,
                            letterSpacing: -0.1,
                            fontVariant: valueMono ? TabularNums : undefined,
                            textAlign: 'right',
                        }}
                    >
                        {value}
                    </Text>
                ) : null}

                {showChevron && (
                    <Ionicons name="chevron-forward" size={17} color={theme.textSecondary} />
                )}
            </View>

            {!isLast && (
                <View
                    style={{
                        height: StyleSheet.hairlineWidth,
                        marginLeft: hairlineIndent,
                        backgroundColor: hairline,
                    }}
                />
            )}
        </>
    );

    if (!onPress && !onLongPress) return body;

    return (
        <Pressable
            onPress={() => { lightImpact(); onPress?.(); }}
            onLongPress={onLongPress}
            delayLongPress={400}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        >
            {body}
        </Pressable>
    );
}
