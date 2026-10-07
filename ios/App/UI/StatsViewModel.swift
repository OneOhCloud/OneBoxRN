import Foundation
import Observation
import Core

// 运行统计真实驱动：注入 AppActions，暴露只读派生状态。
// 与主页速率行同源同拍（同一 Traffic 快照）；本页零引擎调用、零持久化。
// connected 是唯一门控：未连接时 Traffic 会停在最后一帧，故视图必须走空态而非展示陈旧数字。
@MainActor
@Observable
final class StatsViewModel {
    private let actions: AppActions

    init(actions: AppActions) {
        self.actions = actions
    }

    var connected: Bool { actions.connected }
    var traffic: Traffic { actions.traffic }

    /// 已连接但观察通道断流——读数不再可信，全页数值走占位而非陈旧数字。
    /// 连接门控与新鲜度门控是两道独立的闸，缺任一道都会谎报。
    var stale: Bool { actions.trafficStale }

    /// 读数不可信时的统一占位。0 不能拿来顶替——0 是「内核确实产了 0」的合法值。
    nonisolated static let placeholder = "—"

    /// 走势窗口由扩展持有、整份推来，此处只读投影。
    /// 断流期投影为空窗——那些样本描述的是十几秒前，继续画就是把它当成此刻的走势。
    var memoryTrend: MemoryTrend { trendStale ? .empty : actions.sessionStats?.memoryTrend ?? .empty }

    var rateTrend: TrafficRateTrend { trendStale ? .empty : actions.sessionStats?.rateTrend ?? .empty }

    private var trendStale: Bool { stale || actions.sessionStatsStale }

    var uploadRate: String { fresh { TrafficFormat.rate(traffic.up) } }
    var downloadRate: String { fresh { TrafficFormat.rate(traffic.down) } }

    /// 内存的数值与单位走 Core.TrafficFormat 单一来源（与主页速率同实现）。
    var memoryParts: ByteParts {
        guard !stale else { return ByteParts(value: Self.placeholder, unit: "") }
        return TrafficFormat.bytesParts(traffic.memory)
    }

    /// 会话峰值：扩展侧记录，App 挂起期间照常累积。
    var memoryPeak: String {
        fresh { TrafficFormat.bytes(traffic.memoryPeak) }
    }

    /// 连接数为纯整数不加单位。
    var connectionsIn: String { fresh { String(traffic.connIn) } }
    var connectionsOut: String { fresh { String(traffic.connOut) } }

    /// 一处判、一处占位：五项读数各自 `if stale` 会把同一条规则抄六遍，改一次要记得改六处。
    private func fresh(_ value: () -> String) -> String {
        stale ? Self.placeholder : value()
    }
}
