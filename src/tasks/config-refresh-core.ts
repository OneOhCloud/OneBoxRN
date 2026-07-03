/**
 * 配置刷新结果的应用器 —— 依赖注入式纯核心。
 *
 * ProfileConfig / TaskLog / flow-log 以注入依赖的形式传入，刷新的应用侧
 * （KV 写入、TaskRecord 追加、[EVT] 发射）因而可被 node:test 覆盖。原生的
 * 拉取/注册面留在 config-refresh.ts。
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
    /** ProfileConfig 在结构上满足此接口 —— 原样传入即可。 */
    sbConfig: {
        getConfigContent(): string;
        setConfigContent(content: string): void;
        setUsedTraffic(n: number): void;
        setTotalTraffic(n: number): void;
        setExpireTime(t: number): void;
    };
    /** TaskLog 在结构上满足此接口。 */
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

    // 准入闸门：响应体不是配置的“成功”（例如代理透传了无法解码的字节）
    // 会被降级为失败 —— 什么都不持久化，引擎因而绝不会用一份损坏的配置重启。
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
