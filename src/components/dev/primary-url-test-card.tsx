import { getTestPrimaryUrlUnavailable, setTestPrimaryUrlUnavailable } from '@/tasks/config-refresh';
import { ToggleSettingCard } from './toggle-setting-card';

interface PrimaryUrlTestCardProps {
    onSettingChanged?: () => void;
}

export function PrimaryUrlTestCard({ onSettingChanged }: PrimaryUrlTestCardProps) {
    return (
        <ToggleSettingCard
            title="Fallback Test"
            label="Simulate Primary URL Unavailable"
            description={(enabled) =>
                enabled ? 'Primary URL will fail, test fallback' : 'Primary URL works normally'
            }
            getValue={getTestPrimaryUrlUnavailable}
            setValue={setTestPrimaryUrlUnavailable}
            onChanged={onSettingChanged}
            colorScheme="red"
        />
    );
}
