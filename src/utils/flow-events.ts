/**
 * 结构化流程事件 —— 纯核心（node:test 覆盖）。
 *
 * 一个 FlowEvent 携带 {event, flowId, phase, status, …} 贯穿一次用户流程
 * （import、refresh、toggle），使失败可以通过在日志查看器里 grep `flow=<id>`
 * 端到端追踪。事件以稳定的 `[EVT]` 前缀序列化进 message 字符串 —— LogEntry 的
 * 形态仍是 `{id, source, level, message, time}`，日志屏无需改动。非纯的投递
 * （环形缓冲区 + Bugsnag）在 flow-log.ts 里。
 *
 * 脱敏契约：`detail` 必须由调用方预先脱敏（用 log-redact.ts）—— 不得含 URL、
 * token、header 值或 hostname。
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
    /** 预先脱敏的自由文本 —— 绝不含原始 URL/token/header。 */
    detail?: string;
}

let flowCounter = 0;

/** 8 字符 base36 id：时间加盐 + 在 JS 运行时内单调。 */
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
 * 稳定的 key 顺序，undefined 字段省略 —— 可用 `flow=<id>` grep。
 */
export function formatFlowEvent(e: FlowEvent): string {
    const parts = [`[EVT] event=${e.event}`, `flow=${e.flowId}`];
    for (const key of FIELD_ORDER) {
        const value = e[key];
        if (value !== undefined) parts.push(`${key}=${String(value)}`);
    }
    return parts.join(' ');
}
