import { Fonts } from '@/constants/theme';
import { Subscription } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { mediumImpact } from '@/components/ui/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function SubscriptionRow({
    sub,
    isActive,
    isLast,
    onActivate,
    onDelete,
}: {
    sub: Subscription;
    isActive: boolean;
    isLast: boolean;
    onActivate: () => void;
    onDelete: () => void;
}) {
    const theme = useTheme();

    return (
        <Pressable
            onPress={() => { mediumImpact(); onActivate(); }}
            style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 13,
                gap: 12,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.glassBorder,
            })}
        >
            <View style={{
                width: 20, height: 20, borderRadius: 10,
                borderWidth: isActive ? 0 : 2,
                borderColor: theme.border,
                backgroundColor: isActive ? '#007AFF' : 'transparent',
                alignItems: 'center', justifyContent: 'center',
            }}>
                {isActive && <Ionicons name="checkmark" size={12} color="#fff" />}
            </View>

            <Text numberOfLines={1} style={{
                flex: 1,
                fontSize: 15,
                color: isActive ? '#007AFF' : theme.text,
                fontWeight: isActive ? '600' : '400',
                fontFamily: Fonts?.sans,
            }}>
                {sub.name}
            </Text>

            <Pressable
                onPress={() => { mediumImpact(); onDelete(); }}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
            >
                <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
            </Pressable>
        </Pressable>
    );
}
