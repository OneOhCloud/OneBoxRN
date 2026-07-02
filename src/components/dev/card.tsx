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
 * Frosted-glass card matching the iOS 26 design used in the tab screens.
 * Light/dark background comes from `theme.glassBackground`, hairline border
 * from `theme.glassBorder`.
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
            {/* decorative shadow hairline hidden when no title — kept for layout parity */}
            {!title && <View style={{ height: 0, backgroundColor: hairline }} />}
        </View>
    );

    return content;
}
