import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StyleSheet, Text, View } from 'react-native';

interface RowProps {
    label: string;
    value: string;
    valueColor?: string;
    isLast?: boolean;
}

export function Row({ label, value, valueColor, isLast }: RowProps) {
    const theme = useTheme();

    return (
        <View
            style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 11,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <Text style={{ fontSize: 14, color: theme.textSecondary }}>{label}</Text>
            <Text
                style={{
                    fontSize: 14,
                    fontWeight: '500',
                    color: valueColor ?? theme.text,
                    fontFamily: Fonts?.mono,
                    maxWidth: 220,
                }}
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}
