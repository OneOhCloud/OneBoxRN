import { useTheme } from '@/hooks/use-theme';
import React from 'react';
import { View } from 'react-native';

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
    const theme = useTheme();
    return (
        <View style={[{
            backgroundColor: theme.glassBackground,
            borderRadius: 20,
            paddingHorizontal: 16,
            borderWidth: 0.5,
            borderColor: theme.glassBorder,
        }, style]}>
            {children}
        </View>
    );
}
