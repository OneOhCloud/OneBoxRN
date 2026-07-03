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
    /** 用户确认级别变更后触发。 */
    onChanged?: () => void;
}

export function LogLevelCard({ onChanged }: LogLevelCardProps) {
    const { requestRestart } = useVpn();
    // 惰性初始化在首次渲染时读取 store；migration 在 RootLayout 中先于本开发页
    // 挂载运行，因此挂载后无需再次读取。
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
        // 原生 CommandClient 过滤器会在下一条 libbox 日志时读取此值 —— 变更对
        // 实时日志流生效无需重启 tunnel。
        ExpoOneBox.setCoreLogLevel(next);
        // 同时重建 config，让 stdout 与 observable sink 在下次 tunnel 启动时
        // 采用新级别（纵深防御）。
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
