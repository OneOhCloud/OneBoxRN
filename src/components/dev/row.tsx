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
    /** 可选的前导图标方块（SettingsRow 风格）。 */
    iconName?: IconGlyph;
    iconColor?: string;
    /** value 下方的可选次要行。 */
    caption?: string;
    /** 自定义 trailing 会替换默认的 value + chevron。 */
    trailing?: React.ReactNode;
    onPress?: () => void;
    onLongPress?: () => void;
    isLast?: boolean;
}

/**
 * 开发者工具页通用的 iOS 26 列表行。
 * 字号与 `SettingsRow` 一致，使开发页与 Settings / Profiles tab 观感统一。
 * value 默认使用等宽 tabular 数字（开发页几乎全是数值），可按行关闭。
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
