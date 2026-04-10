import { useTheme } from '@/hooks/use-theme';
import { StyleSheet, Text, View } from 'react-native';

interface CardProps {
    title: string;
    children: React.ReactNode;
}

export function Card({ title, children }: CardProps) {
    const theme = useTheme();

    return (
        <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 }}>
                {title}
            </Text>
            <View
                style={{
                    backgroundColor: theme.cardBackground,
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.border,
                }}
            >
                {children}
            </View>
        </View>
    );
}
