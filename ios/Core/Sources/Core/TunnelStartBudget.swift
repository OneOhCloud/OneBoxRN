import Foundation

// 启动预算：宿主愿意等一次启动尝试多久。
//
// 独立成件而不是散在调用点：这个值有**两个**消费方——冷启动的等待沿与热重载的等待沿，
// 而换引擎做的事和启动那一轮一样多，即两者恒等。两处各写一个 20，
// 「它们相等」就成了注释里的一句口头承诺；改一处忘另一处时，没有任何判据会红。
//
// **预算到点不等于失败**：会话仍在推进时，宿主只是不再等了，结局由会话自己
// 在终止沿发布。这个值因此量的是「等多久」，不是「多久算超时失败」——混为一谈会把一次
// 稍慢的成功掐成永久失败。
public enum TunnelStartBudget {
    /// 一次启动尝试的等待上限。
    public static let seconds: Int = 20

    /// 同上，供以 `TimeInterval` 计时的调用方（热重载沿）。
    public static var timeInterval: TimeInterval { TimeInterval(seconds) }

    /// 同上，供 Swift 并发的时钟使用。
    public static var duration: Duration { .seconds(seconds) }
}

/// 一次启动等待的预算钟：从**系统收下启动请求**那一拍起算，不从用户点连接起算。
///
/// 首次连接要先存 VPN 配置，系统为此弹出「添加 VPN 配置」并一直等用户点允许；那段时间启动请求
/// 还没发出。把它算进预算，用户迟疑过 20 秒，等待方就会放弃这次尝试——而放弃会让存完配置之后
/// 那一步发请求被跳过，系统从头到尾没收到请求，诊断却写着「系统收下了启动请求」。
public struct TunnelStartWait {
    private var deadline: ContinuousClock.Instant?

    public init() {}

    /// 记下请求是否已提交；只在第一次看到「已提交」时起钟。
    public mutating func observe(requestSubmitted: Bool, at now: ContinuousClock.Instant) {
        guard requestSubmitted, deadline == nil else { return }
        deadline = now.advanced(by: TunnelStartBudget.duration)
    }

    /// 预算是否已用完；请求未提交前恒为否。
    public func isExpired(at now: ContinuousClock.Instant) -> Bool {
        guard let deadline else { return false }
        return now >= deadline
    }
}
