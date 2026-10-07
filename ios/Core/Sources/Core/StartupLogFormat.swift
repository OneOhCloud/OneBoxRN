import Foundation

/// 启动期引擎日志的行格式（隧道进程写、App 回读）。
///
/// 放在 core 而不是两侧各写一份：写与读是同一个约定，分开写迟早错位，而错位只在
/// 「启动失败、正要看日志」那一拍现形——那时已无从复盘。
public enum StartupLogFormat {
    /// 落盘一行。
    public static func line(_ entry: LogLine) -> String {
        "[\(entry.level.token)] \(entry.message)\n"
    }

    /// 解析一行；空行返回 nil。
    ///
    /// **级别认不出来时按 `info` 收下，不丢弃**：丢弃等于让「启动期说了什么」重新出现空洞，
    /// 而那正是本机制要填的洞。级别猜错只是排序不准，丢行是信息没了——两者代价不对称。
    public static func parse(_ raw: String) -> LogLine? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.hasPrefix("["), let close = trimmed.firstIndex(of: "]") else {
            return LogLine(level: .info, message: trimmed)
        }
        let token = String(trimmed[trimmed.index(after: trimmed.startIndex)..<close])
        let message = String(trimmed[trimmed.index(after: close)...])
            .trimmingCharacters(in: .whitespaces)
        return LogLine(level: LogLevel.fromToken(token) ?? .info, message: message)
    }

    /// 解析一整段（回读时按换行切）。
    public static func parse(block: String) -> [LogLine] {
        block.components(separatedBy: "\n").compactMap(parse)
    }
}
