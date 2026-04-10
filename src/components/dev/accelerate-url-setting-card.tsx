import { getUseAccelerateUrl, setUseAccelerateUrl } from '@/tasks/config-refresh';
import { ToggleSettingCard } from './toggle-setting-card';

interface AccelerateUrlSettingCardProps {
    onSettingChanged?: () => void;
}

export function AccelerateUrlSettingCard({ onSettingChanged }: AccelerateUrlSettingCardProps) {
    return (
        <ToggleSettingCard
            title="Acceleration Settings"
            label="Prioritize Accelerate URL"
            description={(enabled) =>
                enabled ? 'Primary: accelerate, fallback: none' : 'Primary: default, fallback: accelerate'
            }
            getValue={getUseAccelerateUrl}
            setValue={setUseAccelerateUrl}
            onChanged={onSettingChanged}
            colorScheme="green"
        />
    );
}
