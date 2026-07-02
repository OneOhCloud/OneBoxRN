/**
 * Flow-event delivery — the impure counterpart of flow-events.ts.
 *
 * Routes structured events into the in-memory log ring (visible in the
 * Logs viewer, greppable by `flow=<id>`), Bugsnag breadcrumbs, and — for
 * failures — the durable LastFailure KV snapshot that survives
 * clearLogSink(). Payloads carry only identifiers/codes: no URL, query,
 * token, header value, or config body (config-fetch-policy § redaction).
 */

import { LastFailure } from '@/database/kv';
import { formatFlowEvent, type FlowEvent } from '@/utils/flow-events';
import { emitLog } from '@/utils/log-sink';
import Bugsnag from '@bugsnag/expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Same gating expression as the Bugsnag.start call in _layout.tsx.
const bugsnagEnabled = Boolean(Constants.expoConfig?.extra?.bugsnag?.apiKey);

export function logFlowEvent(event: FlowEvent): void {
    emitLog({
        source: 'js',
        level: event.status === 'fail' ? 'error' : 'info',
        message: formatFlowEvent(event),
    });
    if (bugsnagEnabled) {
        try {
            Bugsnag.leaveBreadcrumb(event.event, {
                flowId: event.flowId,
                phase: event.phase,
                status: event.status,
                method: event.method,
                errorCode: event.errorCode,
                durationMs: event.durationMs,
            });
        } catch {
            // Breadcrumbs are best-effort; never let telemetry break a flow.
        }
    }
}

/** Log the failure event AND persist it as the durable latest failure. */
export function recordFlowFailure(event: FlowEvent): void {
    logFlowEvent(event);
    const summary = {
        flowId: event.flowId,
        event: event.event,
        time: new Date().toISOString(),
        platform: Platform.OS,
        phase: event.phase,
        errorCode: event.errorCode,
        detail: event.detail,
    };
    LastFailure.set(summary);
    if (bugsnagEnabled) {
        try {
            Bugsnag.addMetadata('lastFailure', summary);
        } catch {
            // best-effort
        }
    }
}
