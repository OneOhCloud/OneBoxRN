/**
 * Config-refresh result applier — pure core with injected dependencies.
 *
 * Verbatim port of the former `applyResultToSBConfig` in config-refresh.ts:
 * the SBConfig / TaskLog / flow-log globals became injected deps and the four
 * positional parameters became the `RefreshApplyInput` envelope, so the
 * apply-side of a refresh (KV writes, TaskRecord append, [EVT] emission) is
 * node:test coverable. The native fetch/registration surface stays in
 * config-refresh.ts.
 */

import type { TaskRecord, TriggerSource } from '../database/kv.ts';
import type { ConfigRefreshResult } from '../modules/expo-onebox/src/ExpoOneBox.types.ts';
import {
    ERROR_CODE_INVALID_CONTENT,
    errorCodeFromMessage,
    validateConfigContent,
} from '../utils/config-fetch-policy.ts';
import type { FlowEvent } from '../utils/flow-events.ts';
import { djb2Hash, redactUrl } from '../utils/log-redact.ts';

export interface RefreshApplyDeps {
    /** SBConfig satisfies this structurally — pass it as-is. */
    sbConfig: {
        getConfigContent(): string;
        setConfigContent(content: string): void;
        setUsedTraffic(n: number): void;
        setTotalTraffic(n: number): void;
        setExpireTime(t: number): void;
    };
    /** TaskLog satisfies this structurally. */
    taskLog: { append(url: string, record: TaskRecord): void };
    logFlowEvent(event: FlowEvent): void;
    recordFlowFailure(event: FlowEvent): void;
}

export interface RefreshApplyInput {
    result: ConfigRefreshResult;
    url: string;
    trigger: TriggerSource;
    flowId: string;
}

export function applyRefreshResult(deps: RefreshApplyDeps, input: RefreshApplyInput): void {
    const { result, url, trigger, flowId } = input;

    // Acceptance gate: a "success" whose body is not a config (e.g. a proxy
    // handing through undecodable bytes) is demoted to a failure — nothing
    // is persisted, so the engine never restarts on a corrupted config.
    const verdict = result.status === 'success' && result.content
        ? validateConfigContent(result.content)
        : ({ ok: true } as const);
    const status = verdict.ok ? (result.status as 'success' | 'failed' | 'skipped') : 'failed';
    const error = verdict.ok ? result.error : `invalid config content (${verdict.reason})`;

    let contentChanged = false;
    if (result.status === 'success' && verdict.ok) {
        deps.sbConfig.setUsedTraffic(result.profileUpload + result.profileDownload);
        deps.sbConfig.setTotalTraffic(result.profileTotal);
        deps.sbConfig.setExpireTime(result.profileExpire);
        if (result.content && result.content !== deps.sbConfig.getConfigContent()) {
            deps.sbConfig.setConfigContent(result.content);
            contentChanged = true;
        }
    }

    deps.taskLog.append(url, {
        time: result.timestamp,
        status,
        trigger,
        duration: result.durationMs,
        method: result.method ?? 'primary',
        contentChanged,
        error,
        acceleratedUrlRedacted: result.actualUrl ? redactUrl(result.actualUrl) : undefined,
        flowId,
        upload: result.profileUpload,
        download: result.profileDownload,
        total: result.profileTotal,
        expire: result.profileExpire,
    });

    const event = {
        event: 'config_refresh' as const,
        flowId,
        phase: 'refresh' as const,
        status: status === 'success' ? ('ok' as const) : status === 'skipped' ? ('skip' as const) : ('fail' as const),
        method: result.method ?? 'primary',
        durationMs: result.durationMs,
        errorCode: verdict.ok ? errorCodeFromMessage(result.error) : ERROR_CODE_INVALID_CONTENT,
        profileIdHash: djb2Hash(url),
        detail: `trigger=${trigger} contentChanged=${contentChanged}`,
    };
    if (event.status === 'fail') {
        deps.recordFlowFailure(event);
    } else {
        deps.logFlowEvent(event);
    }
}
