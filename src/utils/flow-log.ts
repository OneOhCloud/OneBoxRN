/**
 * 流程事件投递 —— flow-events.ts 的非纯对应物。
 *
 * 把结构化事件路由到内存日志环（在日志查看器里可见，可用 `flow=<id>` grep）、
 * Bugsnag 面包屑，以及针对失败的、能挺过 clearLogSink() 的持久 LastFailure KV
 * 快照。负载只携带标识符/错误码：不含 URL、query、token、header 值或配置体
 * （config-fetch-policy § redaction）。
 */

import { LastFailure } from '@/database/kv';
import { formatFlowEvent, type FlowEvent } from '@/utils/flow-events';
import { emitLog } from '@/utils/log-sink';
import Bugsnag from '@bugsnag/expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// 与 _layout.tsx 里 Bugsnag.start 调用相同的启用判定表达式。
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
            // 面包屑尽力而为；绝不让遥测拖垮流程。
        }
    }
}

/** 记录失败事件，并把它作为持久的“最近一次失败”留存。 */
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
            // 尽力而为
        }
    }
}
