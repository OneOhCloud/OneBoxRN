import { lightImpact } from '@/components/ui/haptics';
import { useAccentBlue, useHairlineColor } from '@/constants/ios26-palette';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface DevHeaderProps {
    onRefresh: () => void;
}

/**
 * Compact dev-screen header. Mirrors the iOS navigation bar metrics used by
 * the tab screens: 44pt content row, rounded title, hairline bottom border.
 * Refresh action uses a quiet chrome pill — not an iconic accent chip — so it
 * stays legible on the glass-card field behind it.
 */
export function DevHeader({ onRefresh }: DevHeaderProps) {
    const theme = useTheme();
    const accent = useAccentBlue();
    const hairline = useHairlineColor();

    return (
        <View>
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 8,
                    height: 44,
                }}
            >
                <Pressable
                    onPress={() => { lightImpact(); router.back(); }}
                    hitSlop={8}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 2,
                        paddingHorizontal: 8,
                        paddingVertical: 6,
                        opacity: pressed ? 0.55 : 1,
                    })}
                >
                    <Ionicons name="chevron-back" size={22} color={accent} />
                    <Text
                        style={{
                            color: accent,
                            fontSize: 17,
                            fontFamily: Fonts?.rounded,
                            fontWeight: '400',
                            letterSpacing: -0.3,
                        }}
                    >
                        Back
                    </Text>
                </Pressable>

                <View style={{ alignItems: 'center' }}>
                    <Text
                        style={{
                            fontSize: 17,
                            fontWeight: '700',
                            color: theme.text,
                            fontFamily: Fonts?.rounded,
                            letterSpacing: -0.4,
                        }}
                    >
                        Developer
                    </Text>
                    <Text
                        style={{
                            fontSize: 10,
                            color: theme.textSecondary,
                            fontFamily: Fonts?.mono,
                            letterSpacing: 0.4,
                            textTransform: 'uppercase',
                            marginTop: 1,
                        }}
                    >
                        diagnostics
                    </Text>
                </View>

                <Pressable
                    onPress={() => { lightImpact(); onRefresh(); }}
                    hitSlop={10}
                    accessibilityLabel="Refresh"
                    style={({ pressed }) => ({
                        padding: 10,
                        borderRadius: 999,
                        opacity: pressed ? 0.55 : 1,
                    })}
                >
                    <Ionicons name="refresh" size={20} color={accent} />
                </Pressable>
            </View>
            <View
                style={{
                    height: StyleSheet.hairlineWidth,
                    marginHorizontal: 16,
                    backgroundColor: hairline,
                }}
            />
        </View>
    );
}
