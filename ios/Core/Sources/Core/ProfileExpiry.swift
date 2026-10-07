/// 配置到期的分档与剩余天数。
///
/// 只分档、不定色：档位到颜色、图标与文案的映射属呈现层。阈值在此处唯一声明。
/// golden/profile-expiry.json 是两端行为裁判（Android core/ProfileExpiry.kt）。
public enum ProfileExpiry: Equatable, Sendable {
    /// 服务端没有下发到期时间。不是「永久」，也不是「已到期」。
    case none
    case normal(daysLeft: Int)
    /// 剩余天数不超过 `soonMaxDays`。
    case soon(daysLeft: Int)
    /// 到期那一刻即算到期。
    case expired

    /// 即将到期档的上界（含）。
    public static let soonMaxDays = 7

    private static let secondsPerDay: Int64 = 86_400

    /// 两个参数都是 Unix 纪元秒。剩余天数按时长向上取整（剩一秒也算 1 天，与参考实现同式），
    /// 不按日历日数，故与时区、本地日界无关。
    public init(expireTime: Int64, now: Int64) {
        guard expireTime > 0 else {
            self = .none
            return
        }
        // 差值不会溢出：到期时刻至多 Int64.max，而此刻是正数。
        let remaining = expireTime - now
        guard remaining > 0 else {
            self = .expired
            return
        }
        let days = Int((remaining - 1) / Self.secondsPerDay + 1)
        self = days <= Self.soonMaxDays ? .soon(daysLeft: days) : .normal(daysLeft: days)
    }

    /// 剩余天数：已到期为 0；没有到期时间时为 nil，不落成一个 0。
    public var daysLeft: Int? {
        switch self {
        case .none: nil
        case .normal(let days), .soon(let days): days
        case .expired: 0
        }
    }
}
