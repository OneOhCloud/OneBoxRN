import { useHairlineColor } from '@/constants/ios26-palette';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StyleSheet, Text, View } from 'react-native';

interface CardProps {
    title?: string;
    subtitle?: string;
    children: React.ReactNode;
}

/**
 * 磨砂玻璃卡片，与 tab 页采用的 iOS 26 设计一致。
 * 明暗背景取自 `theme.glassBackground`，hairline 边框取自 `theme.glassBorder`。
 */
export function Card({ title, subtitle, children }: CardProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();

    const content = (
        <View style={{ marginBottom: Spacing.four }}>
            {title ? (
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'baseline',
                        marginHorizontal: 20,
                        marginBottom: 8,
                        minHeight: 20,
                    }}
                >
                    <Text
                        style={{
                            flex: 1,
                            fontSize: 13,
                            fontFamily: Fonts?.sans,
                            fontWeight: '500',
                            color: theme.textSecondary,
                            letterSpacing: -0.08,
                            textTransform: 'uppercase',
                        }}
                    >
                        {title}
                    </Text>
                    {subtitle ? (
                        <Text
                            style={{
                                fontSize: 11,
                                fontFamily: Fonts?.mono,
                                color: theme.textSecondary,
                                letterSpacing: -0.1,
                            }}
                        >
                            {subtitle}
                        </Text>
                    ) : null}
                </View>
            ) : null}
            <View
                style={{
                    backgroundColor: theme.glassBackground,
                    borderRadius: 20,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.glassBorder,
                    overflow: 'hidden',
                }}
            >
                {children}
            </View>
            {/* 无标题时的装饰性 hairline 占位 —— 为保持布局一致性而保留 */}
            {!title && <View style={{ height: 0, backgroundColor: hairline }} />}
        </View>
    );

    return content;
}
