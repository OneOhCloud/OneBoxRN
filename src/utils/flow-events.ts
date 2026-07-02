/**
 * Structured flow events — pure core (node:test covered).
 *
 * A FlowEvent carries {event, flowId, phase, status, …} through one user
 * flow (import, refresh, toggle) so a failure can be traced end-to-end
 * by grepping `flow=<id>` in the Logs viewer. Events serialize into the
 * message string with a stable `[EVT]` prefix — LogEntry's shape stays
 * `{id, source, level, message, time}` and the Logs screen needs no
 * changes. Impure delivery (ring buffer + Bugsnag) lives in flow-log.ts.
 *
 * Redaction contract: `detail` must already be redacted by the caller
 * (use log-redact.ts) — no URL, token, header value, or hostname.
 */

export type FlowEventName = 'config_import' | 'config_refresh' | 'vpn_toggle';

export type FlowPhase =
    | 'capture'
    | 'verify'
    | 'stop'
    | 'download'
    | 'store'
    | 'process'
    | 'start'
    | 'apply'
    | 'refresh'
    | 'sync';

export type FlowStatus = 'start' | 'ok' | 'fail' | 'skip';

export interface FlowEvent {
    event: FlowEventName;
    flowId: string;
    status: FlowStatus;
    phase?: FlowPhase;
    profileIdHash?: string;
    platform?: string;
    method?: string;
    durationMs?: number;
    errorCode?: string;
    /** Pre-redacted free text — never raw URLs/tokens/headers. */
    detail?: string;
}

let flowCounter = 0;

/** 8-char base36 id: time-salted + monotonic within the JS runtime. */
export function newFlowId(now: number = Date.now()): string {
    flowCounter = (flowCounter + 1) % 1296; // 36^2
    const time = now.toString(36).slice(-6).padStart(6, '0');
    const salt = flowCounter.toString(36).padStart(2, '0');
    return `${time}${salt}`;
}

const FIELD_ORDER = [
    'phase',
    'status',
    'method',
    'durationMs',
    'errorCode',
    'profileIdHash',
    'platform',
    'detail',
] as const;

/**
 * `[EVT] event=config_import flow=ab12cd34 phase=download status=fail …`
 * Stable key order, undefined fields omitted — greppable by `flow=<id>`.
 */
export function formatFlowEvent(e: FlowEvent): string {
    const parts = [`[EVT] event=${e.event}`, `flow=${e.flowId}`];
    for (const key of FIELD_ORDER) {
        const value = e[key];
        if (value !== undefined) parts.push(`${key}=${String(value)}`);
    }
    return parts.join(' ');
}
