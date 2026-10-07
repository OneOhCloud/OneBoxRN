/// 一段时长拆成天、时、分、秒；时恒在 `0…23`。
public struct DurationParts: Sendable, Equatable {
    public let days: Int64
    public let hours: Int64
    public let minutes: Int64
    public let seconds: Int64

    public init(days: Int64, hours: Int64, minutes: Int64, seconds: Int64) {
        self.days = days
        self.hours = hours
        self.minutes = minutes
        self.seconds = seconds
    }
}

// 时长格式化纯函数（首页本次时长用）。只产出结构与纯数字串：
// 「天」这类要随语言变的词不在这里拼，由呈现层按本地化模板组装。
public enum DurationFormat {
    private static let secondsPerMinute: Int64 = 60
    private static let secondsPerHour: Int64 = 3_600
    private static let secondsPerDay: Int64 = 86_400

    public static func parts(seconds: Int64) -> DurationParts {
        precondition(seconds >= 0, "duration seconds must be non-negative: \(seconds)")
        return DurationParts(
            days: seconds / secondsPerDay,
            hours: seconds % secondsPerDay / secondsPerHour,
            minutes: seconds % secondsPerHour / secondsPerMinute,
            seconds: seconds % secondsPerMinute
        )
    }

    /// 钟面 `01:23:45`。小时不封顶：满一天是 `26:03:45` 而不是回到 `02:03:45`，
    /// 与不满一天同一形态，才不会被读成分秒。
    public static func clock(seconds: Int64) -> String {
        let split = parts(seconds: seconds)
        let hours = split.days * 24 + split.hours
        return "\(twoDigits(hours)):\(twoDigits(split.minutes)):\(twoDigits(split.seconds))"
    }

    /// 只到分的钟面 `02:03`：满一天之后天数另说，秒位已没有读的意义。
    public static func hoursMinutes(_ parts: DurationParts) -> String {
        "\(twoDigits(parts.hours)):\(twoDigits(parts.minutes))"
    }

    private static func twoDigits(_ value: Int64) -> String {
        value < 10 ? "0\(value)" : String(value)
    }
}
