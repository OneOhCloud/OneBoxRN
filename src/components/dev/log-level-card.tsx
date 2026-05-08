import { lightImpact, selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { SBConfig, SingBoxLogLevel } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { requestVpnRestart } from '@/utils/vpn-restart';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './card';
import { LogLevelSheet } from './log-level-sheet';
import { Row } from './row';

interface LogLevelCardProps {
    index?: number;
    /** Fired after the user confirms a level change. */
    onChanged?: () => void;
}

export function LogLevelCard({ index, onChanged }: LogLevelCardProps) {
    const [level, setLevel] = useState<SingBoxLogLevel>(() => SBConfig.getLogLevel());
    const sheetRef = useRef<BottomSheetModal>(null);

    useEffect(() => {
        // Pick up any out-of-band change (e.g. migration).
        setLevel(SBConfig.getLogLevel());
    }, []);

    const openSheet = useCallback(() => {
        lightImpact();
        sheetRef.current?.present();
    }, []);

    const handleSelect = useCallback((next: SingBoxLogLevel) => {
        sheetRef.current?.dismiss();
        if (next === level) return;
        selectionChanged();
        setLevel(next);
        SBConfig.setLogLevel(next);
        // The native CommandClient filter reads this on the next libbox
        // log entry — no tunnel restart required for the change to take
        // effect on the live stream.
        ExpoOneBox.setCoreLogLevel(next);
        // Also rebuild config so the stdout + observable sinks pick up
        // the new level on next tunnel start (defence in depth).
        requestVpnRestart();
        onChanged?.();
    }, [level, onChanged]);

    return (
        <>
            <Card title={i18n.t('dev_log_level_title')} index={index}>
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
