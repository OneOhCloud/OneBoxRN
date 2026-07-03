import { lightImpact, selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { ProfileConfig, SingBoxLogLevel } from '@/database/kv';
import { useVpn } from '@/contexts/vpn-context';
import ExpoOneBox from '@/modules/expo-onebox';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useCallback, useRef, useState } from 'react';
import { Card } from './card';
import { LogLevelSheet } from './log-level-sheet';
import { Row } from './row';

interface LogLevelCardProps {
    /** Fired after the user confirms a level change. */
    onChanged?: () => void;
}

export function LogLevelCard({ onChanged }: LogLevelCardProps) {
    const { requestRestart } = useVpn();
    // Lazy init reads the store at first render; migration runs in RootLayout
    // before this dev screen can mount, so no post-mount re-read is needed.
    const [level, setLevel] = useState<SingBoxLogLevel>(() => ProfileConfig.getLogLevel());
    const sheetRef = useRef<BottomSheetModal>(null);

    const openSheet = useCallback(() => {
        lightImpact();
        sheetRef.current?.present();
    }, []);

    const handleSelect = useCallback((next: SingBoxLogLevel) => {
        sheetRef.current?.dismiss();
        if (next === level) return;
        selectionChanged();
        setLevel(next);
        ProfileConfig.setLogLevel(next);
        // The native CommandClient filter reads this on the next libbox
        // log entry — no tunnel restart required for the change to take
        // effect on the live stream.
        ExpoOneBox.setCoreLogLevel(next);
        // Also rebuild config so the stdout + observable sinks pick up
        // the new level on next tunnel start (defence in depth).
        requestRestart();
        onChanged?.();
    }, [level, onChanged, requestRestart]);

    return (
        <>
            <Card title={i18n.t('dev_log_level_title')}>
                <Row
                    iconName="options-outline"
                    iconColor="#5AC8FA"
                    label={i18n.t('dev_log_level_label')}
                    caption={i18n.t('dev_log_level_caption_short')}
                    value={level}
                    valueMono
                    onPress={openSheet}
                    isLast
                />
            </Card>
            <LogLevelSheet ref={sheetRef} current={level} onSelect={handleSelect} />
        </>
    );
}
