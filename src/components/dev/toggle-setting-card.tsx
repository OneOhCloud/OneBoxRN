import { lightImpact } from '@/components/ui/haptics';
import { useState } from 'react';
import { Switch } from 'react-native';
import { Card } from './card';
import { Row } from './row';

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
    // Lazy init covers the mount read; callers pass module-level getters with
    // stable identity, so the removed [getValue] effect only ever re-ran it.
    const [enabled, setEnabled] = useState(() => getValue());

    const handleToggle = (value: boolean) => {
        lightImpact();
        setEnabled(value);
        setValue(value);
        onChanged?.();
    };

    const colors = colorScheme === 'green'
        ? { track: '#34C759', icon: '#34C759', glyph: 'flash-outline' as const }
        : { track: '#FF3B30', icon: '#FF3B30', glyph: 'warning-outline' as const };

    return (
        <Card title={title}>
            <Row
                iconName={colors.glyph}
                iconColor={colors.icon}
                label={label}
                caption={description(enabled)}
                trailing={
                    <Switch
                        value={enabled}
                        onValueChange={handleToggle}
                        trackColor={{ false: '#767577', true: colors.track }}
                        thumbColor="#ffffff"
                        ios_backgroundColor="#3A3A3C"
                    />
                }
                isLast
            />
        </Card>
    );
}
