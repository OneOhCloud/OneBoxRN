import Foundation

/// 观察通道健康度。
///
/// 一个值同时服务两处：呈现层据 `stalled` 决定显不显数字，开发者页据全部三项回答
/// 「通道还活着吗」——通道死掉时统计页照常画旧数字、日志页停在最后一行、连接态显示已连接，
/// 缺了这一项，应用内**没有任何途径**能看出来。
///
/// 与 Android core/ObservationHealth.kt 逐字对应。
public struct ObservationHealth: Sendable, Equatable {
    /// 端点当前归谁。
    public enum Endpoint: String, Sendable, CaseIterable {
        /// 尚未建立：未连接，或建通道失败且还在退避等待。
        case absent
        /// 本实例持有所有权锁并已绑定。
        case bound
        /// 被另一个活实例占用——第二实例没有观察数据是如实的，不是缺陷。
        case busy
    }

    public let endpoint: Endpoint
    /// 通道自报的断流态：由通道层主动推，不是消费方按当前时间算出来的。
    public let stalled: Bool
    /// 本次会话的通道重建次数：稳态恒为 0，非 0 即说明这条通道断过。
    public let rebuildCount: Int

    public static let idle = ObservationHealth(endpoint: .absent, stalled: false, rebuildCount: 0)

    public init(endpoint: Endpoint, stalled: Bool, rebuildCount: Int) {
        precondition(rebuildCount >= 0, "rebuild count must be non-negative: \(rebuildCount)")
        self.endpoint = endpoint
        self.stalled = stalled
        self.rebuildCount = rebuildCount
    }

    public func with(endpoint: Endpoint) -> ObservationHealth {
        ObservationHealth(endpoint: endpoint, stalled: stalled, rebuildCount: rebuildCount)
    }

    public func with(stalled: Bool) -> ObservationHealth {
        ObservationHealth(endpoint: endpoint, stalled: stalled, rebuildCount: rebuildCount)
    }

    /// 重建计数只增不减：它记的是「本次会话断过几次」，不是「当前是不是断的」。
    public func countingRebuild() -> ObservationHealth {
        ObservationHealth(endpoint: endpoint, stalled: stalled, rebuildCount: rebuildCount + 1)
    }
}
