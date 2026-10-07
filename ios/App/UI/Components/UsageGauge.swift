import SwiftUI

// 配额进度条：消费方是配置卡与配置详情的配额条。
//
// **轨与填充都是 `Radius.pill`**——「小到看不出来所以画成直角」不成立，再细的进度条也不例外。
// 档位只有两档：正常 `accent`，超额（已用 ≥ 总量）转错误前景。
struct UsageGauge: View {
    let used: Int64
    let total: Int64

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.fill)
                Capsule()
                    .fill(exhausted ? Theme.error.fg : Theme.accent)
                    .frame(width: max(UsageGaugeMetrics.minimumFill, geo.size.width * fraction))
                    .animation(Theme.motion(Theme.Motion.gaugeFill), value: fraction)
            }
        }
        .frame(height: UsageGaugeMetrics.height)
        .accessibilityElement()
        .accessibilityValue("\(percent)%")
    }

    /// 用量百分比（0–100）；文字百分比与本条着色共用同一来源。
    ///
    /// **无配额（total ≤ 0）是合法业务态但不属本组件**：消费方必须先分支到占位文案。
    /// 带着坏输入渲染比崩掉更糟，故这里 precondition（fail-fast）。
    /// 纯计算，不必随视图绑在主线程上：非视图的文本格式化（`ProfileMetaText`）也读它。
    nonisolated static func percent(used: Int64, total: Int64) -> Int {
        precondition(total > 0, "UsageGauge requires total > 0")
        return Int(min(1, Double(used) / Double(total)) * 100)
    }

    private var fraction: CGFloat {
        CGFloat(Self.percent(used: used, total: total)) / 100
    }

    private var percent: Int { Self.percent(used: used, total: total) }

    private var exhausted: Bool { used >= total }
}

enum UsageGaugeMetrics {
    /// `3` 在卡里读起来是一道细线，那是本仓禁用的装饰线条；`6` 才读成一条有读数的数据条。
    static let height: CGFloat = 6
    /// 填充最小宽度：避免 0% 时整条不可见；与条高相等，最短时是一颗圆点。
    static let minimumFill: CGFloat = 6
}
