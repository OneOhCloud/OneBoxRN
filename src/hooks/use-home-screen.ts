import { SubInfo } from '@/components/ui/home/subscription-info-card';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import { getProcessedConfig } from '@/database/helper';
import { SBConfig } from '@/database/kv';
import ExpoOneBox, { VPN_STATUS } from '@/modules/expo-onebox';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

export function useHomeScreen() {
    const { connected, status } = useVpn();

    const [localLoading, setLocalLoading] = useState(false);
    const loading =
        localLoading || status === VPN_STATUS.STARTING || status === VPN_STATUS.STOPPING;

    const [hasConfig, setHasConfig] = useState<boolean>(() => !!SBConfig.getConfigContent());
    const [subInfo, setSubInfo] = useState<SubInfo>(() => ({
        used: SBConfig.getUsedTraffic(),
        total: SBConfig.getTotalTraffic(),
        expire: SBConfig.getExpireTime(),
    }));
    const [importUrlVisible, setImportUrlVisible] = useState(false);

    const isMounted = useRef(false);
    useFocusEffect(
        useCallback(() => {
            if (isMounted.current) {
                setHasConfig(!!SBConfig.getConfigContent());
                setSubInfo({
                    used: SBConfig.getUsedTraffic(),
                    total: SBConfig.getTotalTraffic(),
                    expire: SBConfig.getExpireTime(),
                });
            } else {
                isMounted.current = true;
            }
        }, [])
    );

    const handleToggleConnect = useCallback(async () => {
        if (loading) return;
        setLocalLoading(true);
        try {
            if (connected) {
                await ExpoOneBox.stop();
            } else {
                if (Platform.OS === 'android') {
                    const hasPermission = await ExpoOneBox.checkVpnPermission();
                    if (!hasPermission) {
                        const granted = await ExpoOneBox.requestVpnPermission();
                        if (!granted) {
                            Alert.alert(i18n.t('insufficient_permission'), i18n.t('permission_required'));
                            return;
                        }
                    }
                }
                const config = Platform.OS === 'web' ? '{}' : await getProcessedConfig();
                await ExpoOneBox.start(config);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : i18n.t('operation_failed');
            if (Platform.OS === 'web') {
                console.error('[Web] VPN toggle error:', msg);
                window.alert(`${i18n.t('error')}: ${msg}`);
            } else {
                Alert.alert(i18n.t('error'), msg);
            }
        } finally {
            setLocalLoading(false);
        }
    }, [connected, loading]);

    const handleImportUrlClose = useCallback(() => {
        setImportUrlVisible(false);
        setHasConfig(!!SBConfig.getConfigContent());
    }, []);

    return {
        connected,
        loading,
        hasConfig,
        subInfo,
        importUrlVisible,
        setImportUrlVisible,
        handleToggleConnect,
        handleImportUrlClose,
    };
}
