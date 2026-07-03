/**
 * sing-box 核心日志级别解析 —— 纯辅助函数。
 *
 * 按用户偏好级别过滤在原生侧完成（`ExpoOneBox.setCoreLogLevel(...)` →
 * Kotlin/Swift 在 CommandClient handler 处过滤，早于日志进入 JS）。背景：
 * sing-box 的 `log.level` 配置只约束 stdout 和 observable sink —— 向我们
 * CommandServer 流供数的 platform writer 是无条件的，因此客户端过滤才是
 * 既定路径。
 *
 * 这里只保留一个小的前缀解析器，让日志查看器能按级别给行着色（error 红、
 * warn 琥珀色）。sing-box 固定的格式为 `strings.ToUpper(FormatLevel(level))`，
 * 即 `TRACE[0000] …`、`INFO[0000] …` 等。ANSI 颜色码可能包裹级别 token
 *（因为 sing-box 的 platform formatter `DisableColors: false`），所以先剥离它们。
 */

import type { SingBoxLogLevel } from '../../database/kv.ts';
import type { LogLevel } from '../../utils/log-sink.ts';

const ANSI_STRIP_RE = /\x1b\[[0-9;]*m/g;
const LEVEL_PREFIX_RE = /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|PANIC)\b/i;

export function parseCoreLineLevel(message: string): SingBoxLogLevel | null {
    const stripped = message.replace(ANSI_STRIP_RE, '').trimStart();
    const m = stripped.match(LEVEL_PREFIX_RE);
    if (!m) return null;
    const token = m[1].toLowerCase();
    if (token === 'warning') return 'warn';
    return token as SingBoxLogLevel;
}

export function sbLevelToEntryLevel(lv: SingBoxLogLevel): LogLevel {
    if (lv === 'error' || lv === 'fatal' || lv === 'panic') return 'error';
    if (lv === 'warn') return 'warn';
    return 'info';
}
