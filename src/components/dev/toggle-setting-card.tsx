import { useTheme } from '@/hooks/use-theme';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from './card';

type ColorScheme = 'green' | 'red';

interface ToggleSettingCardProps {
    title: string;
    label: string;
    description: (enabled: boolean) => string;
    getValue: () => boolean;
    setValue: (enabled: boolean) => void;
    onChanged?: () => void;
    colorScheme?: ColorScheme;
}

export function ToggleSettingCard({
    title,
    label,
    description,
    getValue,
    setValue,
    onChanged,
    colorScheme = 'green',
}: ToggleSettingCardProps) {
    const theme = useTheme();
    const [enabled, setEnabled] = useState(() => getValue());

    useEffect(() => {
        setEnabled(getValue());
    }, [getValue]);

    const handleToggle = (value: boolean) => {
        setEnabled(value);
        setValue(value);
        onChanged?.();
    };

    const colors = colorScheme === 'green'
        ? { track: '#81C784', thumb: '#4CAF50' }
        : { track: '#FF6B6B', thumb: '#FF3B30' };

    return (
        <Card title={title}>
            <View
                style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                }}
            >
                <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: theme.text, fontWeight: '500', marginBottom: 4 }}>
                        {label}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                        {description(enabled)}
                    </Text>
                </View>
                <Switch
                    value={enabled}
                    onValueChange={handleToggle}
                    trackColor={{ false: '#767577', true: colors.track }}
                    thumbColor={enabled ? colors.thumb : '#f4f3f4'}
                />
            </View>
        </Card>
    );
}
