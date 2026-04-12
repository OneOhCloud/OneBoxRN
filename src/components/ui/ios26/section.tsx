/**
 * iOS 26 shared section primitives.
 *
 * - `SectionHeader` — grouped-inset list header, optional trailing action.
 * - `SectionAction` — iOS 26 rounded tint pill used inside section headers.
 *
 * These are lifted out of profile.tsx so any tab screen can import them
 * without duplicating markup or diverging on typography/spacing. Keep changes
 * here synchronized — every tab should render headers with identical metrics
 * so cross-tab transitions don't shift vertical layout.
 */
import { mediumImpact } from '@/components/ui/haptics';
import { ACCENT, ACCENT_LIGHT } from '@/components/ui/profiles/active-profile-card';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import React from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle, useColorScheme } from 'react-native';

// ─── Section header ────────────────────────────────────────────────────────
export function SectionHeader({
    label,
    trailing,
}: {
    label: string;
    trailing?: React.ReactNode;
}) {
    const theme = useTheme();
    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginHorizontal: 20,
                marginBottom: 8,
                minHeight: 24,
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
                }}
            >
                {label}
            </Text>
            {trailing}
        </View>
    );
}

// ─── Tint pill action (used inside SectionHeader.trailing) ─────────────────
export function SectionAction({
    label,
    active,
    onPress,
    accessibilityLabel,
}: {
    label: string;
    active?: boolean;
    onPress: () => void;
    accessibilityLabel?: string;
}) {
    const isDark = useColorScheme() === 'dark';
    const accentBlue = isDark ? ACCENT : ACCENT_LIGHT;

    const bg: StyleProp<ViewStyle> = active
        ? { backgroundColor: accentBlue }
        : {
              backgroundColor: isDark
                  ? 'rgba(255, 255, 255, 0.10)'
                  : 'rgba(11, 13, 18, 0.06)',
          };

    return (
        <Pressable
            onPress={() => { mediumImpact(); onPress(); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            style={({ pressed }) => [
                {
                    opacity: pressed ? 0.55 : 1,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 999,
                },
                bg,
            ]}
        >
            <Text
                style={{
                    fontSize: 13,
                    fontFamily: Fonts?.rounded,
                    fontWeight: '700',
                    letterSpacing: -0.2,
                    color: active ? '#ffffff' : accentBlue,
                }}
            >
                {label}
            </Text>
        </Pressable>
    );
}
