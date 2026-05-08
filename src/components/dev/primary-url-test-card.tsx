import { getTestPrimaryUrlUnavailable, setTestPrimaryUrlUnavailable } from '@/tasks/config-refresh';
import { ToggleSettingCard } from './toggle-setting-card';

interface PrimaryUrlTestCardProps {
    onSettingChanged?: () => void;
    index?: number;
}

export function PrimaryUrlTestCard({ onSettingChanged, index }: PrimaryUrlTestCardProps) {
    return (
        <ToggleSettingCard
            title="Fallback Test"
            label="Simulate Primary URL Unavailable"
            description={(enabled) =>
                enabled
                    ? 'Foreground refresh only: skip primary to test accelerate fallback'
                    : 'Foreground refresh: primary first (normal)'
            }
            getValue={getTestPrimaryUrlUnavailable}
            setValue={setTestPrimaryUrlUnavailable}
            onChanged={onSettingChanged}
            colorScheme="red"
            index={index}
        />
    );
}
