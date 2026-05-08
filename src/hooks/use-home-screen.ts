import type { SubInfo } from '@/utils';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import { getProcessedConfig } from '@/database/helper';
import { ProfileStore } from '@/database/kv';
import ExpoOneBox, { VPN_STATUS } from '@/modules/expo-onebox';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

interface ActiveProfileSnapshot {
    hasConfig: boolean;
    subInfo: SubInfo;
    name: string | null;
}

function readActiveProfile(): ActiveProfileSnapshot {
    const active = ProfileStore.getActive();
    return {
        hasConfig: !!active?.configContent,
        subInfo: {
            used: active?.usedTraffic ?? 0,
            total: active?.totalTraffic ?? 1,
            expire: active?.expireTime ?? 0,
        },
        name: active?.name ?? null,
    };
}

export function useHomeScreen() {
    const { connected, status } = useVpn();

    const [localLoading, setLocalLoading] = useState(false);
    const loading =
        localLoading || status === VPN_STATUS.STARTING || status === VPN_STATUS.STOPPING;

    const [snapshot, setSnapshot] = useState<ActiveProfileSnapshot>(readActiveProfile);
    const [importUrlVisible, setImportUrlVisible] = useState(false);

    const isMounted = useRef(false);
    useFocusEffect(
        useCallback(() => {
            if (isMounted.current) {
                setSnapshot(readActiveProfile());
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
        setSnapshot(readActiveProfile());
    }, []);

    return {
        connected,
        loading,
        hasConfig: snapshot.hasConfig,
        subInfo: snapshot.subInfo,
        profileName: snapshot.name,
        importUrlVisible,
        setImportUrlVisible,
        handleToggleConnect,
        handleImportUrlClose,
    };
}
