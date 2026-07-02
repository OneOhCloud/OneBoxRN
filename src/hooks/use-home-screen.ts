import type { SubInfo } from '@/utils';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import { startFailureErrorCode } from '@/contexts/vpn/actions';
import type { StartFailure } from '@/contexts/vpn/types';
import { ProfileStore } from '@/database/kv';
import { VPN_STATUS } from '@/modules/expo-onebox';
import { newFlowId } from '@/utils/flow-events';
import { logFlowEvent, recordFlowFailure } from '@/utils/flow-log';
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
    const { connected, status, start, stop } = useVpn();

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

    const presentToggleError = useCallback((msg: string) => {
        if (Platform.OS === 'web') {
            console.error('[Web] VPN toggle error:', msg);
            window.alert(`${i18n.t('error')}: ${msg}`);
        } else {
            Alert.alert(i18n.t('error'), msg);
        }
    }, []);

    const presentStartFailure = useCallback((failure: StartFailure) => {
        switch (failure.kind) {
            case 'permission-denied':
                Alert.alert(i18n.t('insufficient_permission'), i18n.t('permission_required'));
                return;
            case 'aborted':
            case 'timeout':
                // No signal/timeout is passed from this screen — unreachable.
                return;
            case 'config-error':
            case 'native-error':
                presentToggleError(failure.message || i18n.t('operation_failed'));
        }
    }, [presentToggleError]);

    const handleToggleConnect = useCallback(async () => {
        if (loading) return;
        setLocalLoading(true);
        const flowId = newFlowId();
        const phase = connected ? 'stop' : 'start';
        logFlowEvent({ event: 'vpn_toggle', flowId, phase, status: 'start' });
        try {
            if (connected) {
                // Resolves on the STOPPED event (≤10 s) — the derived
                // `loading` already covers the STOPPING span either way.
                const result = await stop();
                if (result.outcome === 'stop-rejected') {
                    recordFlowFailure({ event: 'vpn_toggle', flowId, phase, status: 'fail', errorCode: 'UNKNOWN' });
                    presentToggleError(result.message || i18n.t('operation_failed'));
                } else {
                    logFlowEvent({ event: 'vpn_toggle', flowId, phase, status: 'ok', detail: `outcome=${result.outcome}` });
                }
            } else {
                const result = await start();
                if (!result.ok) {
                    recordFlowFailure({
                        event: 'vpn_toggle', flowId, phase, status: 'fail',
                        errorCode: startFailureErrorCode(result.failure),
                        detail: `kind=${result.failure.kind}`,
                    });
                    presentStartFailure(result.failure);
                } else {
                    logFlowEvent({ event: 'vpn_toggle', flowId, phase, status: 'ok' });
                }
            }
        } finally {
            setLocalLoading(false);
        }
    }, [connected, loading, start, stop, presentStartFailure, presentToggleError]);

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
