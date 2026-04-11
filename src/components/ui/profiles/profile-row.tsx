import { Fonts } from '@/constants/theme';
import { Profile } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { mediumImpact } from '@/components/ui/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ProfileRow({
    sub,
    isActive,
    isFirst,
    isLast,
    onActivate,
    onDelete,
}: {
    sub: Profile;
    isActive: boolean;
    isFirst: boolean;
    isLast: boolean;
    onActivate: () => void;
    onDelete: () => void;
}) {
    const theme = useTheme();

    const R = 18;
    const borderTopLeftRadius = isActive && isFirst ? R : 0;
    const borderTopRightRadius = isActive && isFirst ? R : 0;
    const borderBottomLeftRadius = isActive && isLast ? R : 0;
    const borderBottomRightRadius = isActive && isLast ? R : 0;

    return (
        <Pressable
            onPress={() => { mediumImpact(); onActivate(); }}
            style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 13,
                paddingHorizontal: isActive ? 16 : 0,
                marginHorizontal: isActive ? -16 : 0,
                gap: 12,
                borderTopLeftRadius,
                borderTopRightRadius,
                borderBottomLeftRadius,
                borderBottomRightRadius,
                backgroundColor: isActive ? 'rgba(174, 174, 178, 0.28)' : 'transparent',
                borderBottomWidth: isLast || isActive ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.glassBorder,
            })}
        >
            <View style={{
                width: 20, height: 20, borderRadius: 10,
                borderWidth: isActive ? 0 : 2,
                borderColor: isActive ? theme.text : theme.border,
                backgroundColor: isActive ? theme.text : 'transparent',
                alignItems: 'center', justifyContent: 'center',
            }}>
                {isActive && <Ionicons name="checkmark" size={12} color={theme.background} />}
            </View>

            <Text numberOfLines={1} style={{
                flex: 1,
                fontSize: 15,
                color: theme.text,
                fontWeight: isActive ? '600' : '400',
                fontFamily: Fonts?.sans,
            }}>
                {sub.name}
            </Text>

            {(!isActive || (isFirst && isLast)) && (
                <Pressable
                    onPress={() => { mediumImpact(); onDelete(); }}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
                >
                    <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
                </Pressable>
            )}
        </Pressable>
    );
}
