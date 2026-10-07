import Foundation

/// 隧道会话的运行统计：近 60 秒内存与网速走势、会话起点。
///
/// 由隧道进程持有、逐帧追加，并随观察通道**整份**推给 App。App 不自己累积：它进后台时观察
/// 通道停流，自己攒的窗口就会断档；扩展进程一直在跑，只有它手里的窗口是连续的。
///
/// 所有时刻取自隧道进程的单调时钟，只在同一份统计内部可比——App 只按相对位置呈现，
/// 不拿它和自己的时钟比。
public struct SessionStats: Sendable, Equatable {
    public let startedAtMillis: Int64
    public let memoryTrend: MemoryTrend
    public let rateTrend: TrafficRateTrend

    public init(startedAtMillis: Int64, memoryTrend: MemoryTrend = .empty, rateTrend: TrafficRateTrend = .empty) {
        self.startedAtMillis = startedAtMillis
        self.memoryTrend = memoryTrend
        self.rateTrend = rateTrend
    }

    /// 会话已运行时长：截至最新一帧。尚无帧时为 0。
    public var uptimeMillis: Int64 {
        guard let newest = memoryTrend.samples.last else { return 0 }
        return newest.atMillis - startedAtMillis
    }

    /// 两块走势必须同拍追加：观察帧把它们编码在同一条时间轴上。
    public func appending(atMillis: Int64, traffic: Traffic) -> SessionStats {
        SessionStats(
            startedAtMillis: startedAtMillis,
            memoryTrend: memoryTrend.appending(atMillis: atMillis, bytes: traffic.memory),
            rateTrend: rateTrend.appending(atMillis: atMillis, up: traffic.up, down: traffic.down)
        )
    }
}

/// 扩展侧会话统计的接收方。独立于 `MonitorHandler`：只有隧道跑在独立进程、App 挂起即断流的
/// 平台才需要由扩展整份推送统计，中立契约不为此加宽。
public protocol SessionStatsHandler: AnyObject {
    func onSessionStats(_ stats: SessionStats)
}
