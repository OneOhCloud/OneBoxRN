/**
 * iOS 26 shared section primitives. Every tab renders headers with identical
 * metrics so cross-tab transitions don't shift vertical layout — keep changes
 * here synchronized.
 */
import { mediumImpact } from '@/components/ui/haptics';
import { useAccentBlue, useQuietChrome } from '@/constants/ios26-palette';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import React from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';

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
    const accentBlue = useAccentBlue();
    const quietBg = useQuietChrome();

    const bg: StyleProp<ViewStyle> = active
        ? { backgroundColor: accentBlue }
        : { backgroundColor: quietBg };

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
