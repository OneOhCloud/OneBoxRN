/**
 * React adapter over the import-flow machine (import-flow-machine.ts).
 *
 * Owns the impure wiring — context actions, native fetch bridge, profile
 * store, flow logging, haptics — plus the two presentation concerns the
 * pure core must not know about: mapping typed ImportErrors onto i18n
 * strings and navigating home once the applied phase lands (one microtask
 * later than the pre-refactor inline call; accepted).
 */
import { notifyError, notifySuccess } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import type { StartFailure } from '@/contexts/vpn/types';
import { ProfileStore } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { verifyHostname } from '@/utils/domain-verification';
import { logFlowEvent, recordFlowFailure } from '@/utils/flow-log';
import { jsLog } from '@/utils/log-sink';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
    createImportFlowMachine,
    type ImportError,
    type ImportPhase,
} from './import-flow-machine';

/**
 * Maps a typed context-start failure onto this screen's user-visible
 * message vocabulary (wrapped in `config_apply_failed` below, matching the
 * previous throw-based strings exactly). 'aborted' never reaches here —
 * the machine drops it at the phase boundary.
 */
function mapStartFailureMessage(failure: Exclude<StartFailure, { kind: 'aborted' }>): string {
    switch (failure.kind) {
        case 'permission-denied':
            return i18n.t('config_permission_denied');
        case 'timeout':
            return i18n.t('config_apply_timeout', { seconds: failure.timeoutMs / 1000 });
        case 'config-error':
        case 'native-error':
            return failure.message;
    }
}

function mapImportError(error: ImportError): string {
    switch (error.kind) {
        case 'verify-failed':
            return i18n.t('config_verify_failed', { message: error.message });
        case 'download-http':
            return i18n.t('config_error_status', { code: error.statusCode });
        case 'download-network':
            return error.message;
        case 'start-failed':
            return i18n.t('config_apply_failed', { message: mapStartFailureMessage(error.failure) });
    }
}

export interface ImportFlowView {
    phase: ImportPhase;
    /** Pre-localized message when phase is 'error'; null otherwise. */
    errorMessage: string | null;
}

export function useImportFlow(input: { data?: string; apply?: string }): ImportFlowView {
    const { start, stop } = useVpn();

    // One machine per screen instance; route params never change in place.
    // start/stop are module-scope action singletons (stable identities), so
    // capturing them in the lazy init is safe.
    const [machine] = useState(() =>
        createImportFlowMachine(
            { data: input.data, apply: input.apply },
            {
                verifyHostname,
                stop,
                start,
                fetchConfig: (url, userAgent) => ExpoOneBox.fetchSubscription(url, userAgent),
                userAgent: getSingBoxUserAgent(),
                profiles: ProfileStore,
                logFlowEvent,
                recordFlowFailure,
                haptics: { notifySuccess, notifyError },
                log: jsLog,
            },
        ),
    );

    useEffect(() => {
        machine.run();
        return () => machine.cancel();
    }, [machine]);

    const phase = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);

    useEffect(() => {
        if (phase.phase !== 'applied') return;
        jsLog.info('[Config] apply: success → router.dismissTo("/")');
        router.dismissTo('/');
    }, [phase]);

    return {
        phase,
        errorMessage: phase.phase === 'error' ? mapImportError(phase.error) : null,
    };
}
