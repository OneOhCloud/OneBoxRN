/**
 * 启动失败诊断快照的纯格式化辅助。
 *
 * VpnContext 在失败时刻用它把 log-sink 的最近日志与本次启动配置压缩成
 * 可复制的诊断文本行 —— 让失败弹窗自带定位上下文，而不是只有一句通用文案。
 */
import { djb2Hash } from './log-redact.ts';
import type { LogEntry } from './log-sink.ts';

/** 单行日志在诊断文本里的长度上限 —— 防止超长的核心日志撑爆弹窗/剪贴板。 */
const MAX_LINE_CHARS = 300;

/** 失败快照采集的日志条数。 */
export const DIAGNOSTIC_LOG_COUNT = 15;

/**
 * 把一条日志格式化为诊断详情里的单行："HH:MM:SS.mmm [source/level] message"。
 * 时间取 UTC（与弹窗头部的 ISO 时间同一时区），超长消息截断并以 … 标记。
 */
export function formatDiagnosticLogLine(entry: LogEntry): string {
    const time = new Date(entry.time).toISOString().slice(11, 23);
    const message = entry.message.length > MAX_LINE_CHARS
        ? `${entry.message.slice(0, MAX_LINE_CHARS)}…`
        : entry.message;
    return `${time} [${entry.source}/${entry.level}] ${message}`;
}

/**
 * 本次启动所用配置的指纹（长度 + djb2）—— 不含配置内容本身，用于比对
 * "两次失败是否同一份配置" 而不泄露节点信息。空配置返回 null。
 */
export function configFingerprintOf(config: string): string | null {
    if (!config) return null;
    return `len=${config.length} djb2=#${djb2Hash(config)}`;
}
