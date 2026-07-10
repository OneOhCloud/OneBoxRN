/**
 * 配置刷新结果的应用器 —— 依赖注入式纯核心。
 *
 * ProfileStore / TaskLog / flow-log 以注入依赖的形式传入，刷新的应用侧
 * （KV 写入、TaskRecord 追加、[EVT] 发射）因而可被 node:test 覆盖。原生的
 * 拉取/注册面留在 config-refresh.ts。
 *
 * 不变量：刷新结果只写入其来源 URL（`input.url`）所对应的配置文件 ——
 * 绝不默认写当前活动配置。来源 URL 无匹配（配置已被删除/更换）时整个结果
 * 被丢弃，只留一条 skip 事件。
 */

import type { TaskRecord, TriggerSource } from '../database/kv.ts';
import type { Profile } from '../database/profile-store-core.ts';
import type { ConfigRefreshResult } from '../modules/expo-onebox/src/ExpoOneBox.types.ts';
import {
    ERROR_CODE_INVALID_CONTENT,
    errorCodeFromMessage,
    validateConfigContent,
} from '../utils/config-fetch-policy.ts';
import type { FlowEvent } from '../utils/flow-events.ts';
import { djb2Hash, redactUrl } from '../utils/log-redact.ts';

export interface RefreshApplyDeps {
    /** ProfileStore 在结构上满足此接口 —— 原样传入即可。 */
    profiles: {
        findByUrl(url: string): Profile | null;
        update(id: string, patch: Partial<Omit<Profile, 'id' | 'addedAt'>>): void;
    };
    /** TaskLog 在结构上满足此接口。 */
    taskLog: { append(url: string, record: TaskRecord): void };
    logFlowEvent(event: FlowEvent): void;
    recordFlowFailure(event: FlowEvent): void;
}

export interface RefreshApplyInput {
    result: ConfigRefreshResult;
    /** 本次刷新的来源配置 URL —— 写入目标由它解析，而非活动配置。 */
    url: string;
    trigger: TriggerSource;
    flowId: string;
}

/** applyRefreshResult 的可观察结论 —— 供测试与 dev-harness 断言写入目标。 */
export type ApplyOutcome =
    | { status: 'applied'; targetProfileId: string; contentChanged: boolean }
    /** 结果未成功（failed/skipped/内容无效）：仅记录 TaskLog 与事件，不写配置。 */
    | { status: 'recorded'; targetProfileId: string }
    /** 来源 URL 无匹配配置：零写入，仅一条 skip 事件。 */
    | { status: 'dropped' };

/**
 * 解析结果的来源 URL。旧版原生存的结果不带 configUrl（read-and-clear 单槽，
 * 升级后至多出现一次）—— 回落到活动配置 URL 并标记 legacy，由调用方决定告警。
 */
export function resolveResultOriginUrl(
    result: { configUrl?: string },
    activeUrl: string | null,
): { url: string | null; legacy: boolean } {
    if (result.configUrl) return { url: result.configUrl, legacy: false };
    if (activeUrl) return { url: activeUrl, legacy: true };
    return { url: null, legacy: false };
}

export function applyRefreshResult(deps: RefreshApplyDeps, input: RefreshApplyInput): ApplyOutcome {
    const { result, url, trigger, flowId } = input;

    const target = deps.profiles.findByUrl(url);
    if (!target) {
        deps.logFlowEvent({
            event: 'config_refresh',
            flowId,
            phase: 'refresh',
            status: 'skip',
            method: result.method ?? 'primary',
            durationMs: result.durationMs,
            profileIdHash: djb2Hash(url),
            detail: `trigger=${trigger} dropped=no-matching-profile`,
        });
        return { status: 'dropped' };
    }

    // 准入闸门：响应体不是配置的“成功”（例如代理透传了无法解码的字节）
    // 会被降级为失败 —— 什么都不持久化，引擎因而绝不会用一份损坏的配置重启。
    const verdict = result.status === 'success' && result.content
        ? validateConfigContent(result.content)
        : ({ ok: true } as const);
    const status = verdict.ok ? (result.status as 'success' | 'failed' | 'skipped') : 'failed';
    const error = verdict.ok ? result.error : `invalid config content (${verdict.reason})`;

    let contentChanged = false;
    let profileWritten = false;
    if (result.status === 'success' && verdict.ok) {
        const patch: Partial<Omit<Profile, 'id' | 'addedAt'>> = {
            usedTraffic: result.profileUpload + result.profileDownload,
            totalTraffic: result.profileTotal,
            expireTime: result.profileExpire,
        };
        if (result.content && result.content !== target.configContent) {
            patch.configContent = result.content;
            contentChanged = true;
        }
        deps.profiles.update(target.id, patch);
        profileWritten = true;
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

    return profileWritten
        ? { status: 'applied', targetProfileId: target.id, contentChanged }
        : { status: 'recorded', targetProfileId: target.id };
}
