/**
 * sing-box core log-level parsing — pure helpers moved out of
 * vpn-context.tsx.
 *
 * Filtering by the user's preferred level is done on the native side
 * (`ExpoOneBox.setCoreLogLevel(...)` → Kotlin/Swift filter at the
 * CommandClient handler, before entries cross into JS). Background:
 * sing-box's `log.level` config only gates stdout and the observable
 * sink — the platform writer feeding our CommandServer stream is
 * unconditional (see `sing-box/log/observable.go:112-143` and
 * `daemon/instance.go:109` in the vendored tree). Client-side
 * filtering is the documented path.
 *
 * Here we keep only a small prefix parser so the Logs viewer can
 * colour rows by level (error red, warn amber). The format is fixed
 * by sing-box's `log/format.go:24`: `strings.ToUpper(FormatLevel(
 * level))`, i.e. `TRACE[0000] …`, `INFO[0000] …`, etc. ANSI colour
 * codes may wrap the level token because sing-box's platform
 * formatter has `DisableColors: false`, so we strip them first.
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
