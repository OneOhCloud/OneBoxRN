import { lightImpact } from '@/components/ui/haptics';
import { useHairlineColor } from '@/constants/ios26-palette';
import { Fonts, TabularNums } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const SETTINGS_ROW = {
    paddingVertical: 13,
    paddingHorizontal: 16,
    iconSize: 29,
    iconRadius: 7,
    iconGlyph: 16,
    gap: 12,
    hairlineIndent: 16 + 29 + 12,
} as const;

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
    /** 显示在右侧的简单字符串值，使用次要色。 */
    value?: string;
    /** 提供时，自定义尾部内容会替换 `value` + chevron。 */
    trailing?: React.ReactNode;
    /** value 的字体族覆盖。默认 SF sans。 */
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
        <>
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: SETTINGS_ROW.paddingVertical,
                    paddingHorizontal: SETTINGS_ROW.paddingHorizontal,
                    gap: SETTINGS_ROW.gap,
                }}
            >
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
                            fontVariant: valueMono ? TabularNums : undefined,
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
        </>
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
