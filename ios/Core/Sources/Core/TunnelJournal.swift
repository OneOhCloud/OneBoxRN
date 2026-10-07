import Foundation

/// 隧道运行期日志：隧道进程写，App 与取证读。
///
/// 扩展被 jetsam / SIGKILL / 崩溃时，进程内什么都来不及做，事后读得到的只有已经落盘的行。
/// 运行期日志的正常去向（观察通道 → App 内存）恰恰在 App 不在前台时断开，所以生命周期沿、
/// 告警以上的引擎日志与定时体征必须即时落盘。
///
/// 行格式与「上一个会话怎么结束的」判定放在这里，写读两侧共用一份。
public enum TunnelJournal {
    public static let fileName = "tunnel.log"
    public static let rotatedFileName = "tunnel.1.log"

    /// 单文件上限：写满即把当前文件轮转成 `rotatedFileName`。配合单行上限，总占用有界。
    public static let fileCapBytes = 1024 * 1024

    /// 单行详情上限：引擎日志原文长度不受本端控制，一行不能把轮转预算吃掉。
    public static let maxDetailBytes = 2048

    /// 用户主动断开时 `session-end` 行携带的原因名。App 据此区分「用户关的」与「系统停的」，
    /// 两侧共用这一处字面量。
    public static let userStopReason = "userInitiated"

    public enum Event: String, Sendable {
        case sessionBegin = "session-begin"
        case sessionStarted = "session-started"
        case sessionEnd = "session-end"
        case cancel
        case sleep
        case wake
        case reload
        case network
        case memoryPressure = "memory-pressure"
        case vitals
        case engine
        case journal
    }

    /// 一条记录一行：`<ISO8601 带毫秒与时区> <事件> <详情>`。
    ///
    /// 详情里的换行转义成字面 `\n`：一条记录跨多行的话，判定会把后半截当成另一条记录。
    public static func line(at date: Date, event: Event, detail: String, timeZone: TimeZone = .current) -> String {
        let escaped = detail
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n")
        let bounded = String(decoding: truncatedUtf8(escaped, maxBytes: maxDetailBytes), as: UTF8.self)
        let head = "\(timestamp(date, timeZone: timeZone)) \(event.rawValue)"
        return (bounded.isEmpty ? head : "\(head) \(bounded)") + "\n"
    }

    /// `session-end` 行的原因详情。写侧只经这里拼，读侧的 `isUserStop` 才能与之对上。
    public static func stopDetail(reason: String, code: Int) -> String {
        "reason=\(reason)(\(code))"
    }

    /// 这条结束详情是否出自用户主动断开。
    public static func isUserStop(_ endDetail: String) -> Bool {
        endDetail.hasPrefix("reason=\(userStopReason)(")
    }

    /// 按时间先后读出全部日志（轮转文件在前）。
    ///
    /// 只有「文件不存在」是正常形态；其余读失败向上抛——读不全就不能对会话结局下结论。
    /// 按宽松 UTF-8 解码：进程被杀在写到一半时，尾部半个字符不应让整份日志作废。
    public static func readAll(files: any TunnelFiles) throws -> String {
        try [TunnelFile.journalRotated, .journalCurrent].map { file -> String in
            (try files.read(file)).map { String(decoding: $0, as: UTF8.self) } ?? ""
        }.joined()
    }

    /// 追加这一行之后是否会超过单文件上限。空文件恒不轮转：单行超限时轮转也放不下它。
    public static func shouldRotate(currentBytes: Int, appendingBytes: Int) -> Bool {
        currentBytes > 0 && currentBytes + appendingBytes > fileCapBytes
    }

    /// 最后一个会话的结局。`text` 是按时间先后拼接的全部日志（轮转文件在前）。
    ///
    /// 只在**没有隧道在跑**的时刻调用才有意义：正在运行的会话同样没有结束行。
    public static func lastSessionEnding(in text: String) -> SessionEnding {
        let records = text.split(separator: "\n", omittingEmptySubsequences: true).compactMap(Record.init)
        guard let beginIndex = records.lastIndex(where: { $0.event == Event.sessionBegin.rawValue }) else {
            return .none
        }
        let began = records[beginIndex].timestamp
        let session = records[(beginIndex + 1)...]
        if let end = session.last(where: { $0.event == Event.sessionEnd.rawValue }) {
            return .ended(beganAt: began, detail: end.detail)
        }
        let lastRecord = records[records.index(before: records.endIndex)]
        let lastVitals = session.last(where: { $0.event == Event.vitals.rawValue })
        return .unexpected(
            beganAt: began,
            lastRecordAt: lastRecord.timestamp,
            lastVitals: lastVitals?.detail
        )
    }

    /// ISO8601（毫秒 + 时区偏移）。不用系统日期格式化器：它的日历与数字字形跟随环境，
    /// 而 Core 里用不到 App 侧那个钉死 locale 的唯一构造点。显式公历分量 + 整数格式化恒为公历 ASCII。
    private static func timestamp(_ date: Date, timeZone: TimeZone) -> String {
        let totalMillis = Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
        let millis = Int(((totalMillis % 1000) + 1000) % 1000)
        let whole = Date(timeIntervalSince1970: TimeInterval((totalMillis - Int64(millis)) / 1000))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: whole)
        let offsetSeconds = timeZone.secondsFromGMT(for: whole)
        let zone = offsetSeconds == 0
            ? "Z"
            : String(
                format: "%@%02d:%02d",
                offsetSeconds < 0 ? "-" : "+",
                abs(offsetSeconds) / 3600,
                abs(offsetSeconds) % 3600 / 60
            )
        return String(
            format: "%04d-%02d-%02dT%02d:%02d:%02d.%03d%@",
            parts.year ?? 0, parts.month ?? 0, parts.day ?? 0,
            parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, millis, zone
        )
    }

    // 截断落在 UTF-8 字符边界上：直接切字节会在行尾留下替换字符。
    private static func truncatedUtf8(_ text: String, maxBytes: Int) -> Data {
        let utf8 = Data(text.utf8)
        if utf8.count <= maxBytes { return utf8 }
        var end = maxBytes
        while end > 0, utf8[utf8.startIndex + end] & 0xC0 == 0x80 { end -= 1 }
        return utf8.prefix(end)
    }

    private struct Record {
        let timestamp: String
        let event: String
        let detail: String

        init?(_ line: Substring) {
            let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: false)
            guard parts.count >= 2 else { return nil }
            timestamp = String(parts[0])
            event = String(parts[1])
            detail = parts.count == 3 ? String(parts[2]) : ""
        }
    }
}

public enum SessionEnding: Equatable, Sendable {
    /// 日志里没有任何会话。
    case none
    /// 走到了停止回调：`detail` 是 `session-end` 行的详情（含停止原因）。
    case ended(beganAt: String, detail: String)
    /// 有开始、没有结束：进程在没有停止回调的情况下消失了（被系统杀掉或崩溃）。
    case unexpected(beganAt: String, lastRecordAt: String, lastVitals: String?)
}
