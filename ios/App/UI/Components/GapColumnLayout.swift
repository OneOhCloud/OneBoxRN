import SwiftUI

/// 一条缝的分配规则：自由空间按 `weight` 成比例分到各缝；按比例分到的份额低于 `minimum` 时钉在下限。
struct GapRule: Equatable {
    let minimum: CGFloat
    let weight: CGFloat
}

enum GapDistribution {
    /// 把 `free` 分给各缝：先按权重成比例分，份额不足下限的缝钉在下限，其余缝就剩下的空间重新按权重分，
    /// 直到没有缝再被钉住。空间连下限都凑不齐时全部取下限（总和超出 `free`，由外层滚动吸收）。
    static func sizes(free: CGFloat, rules: [GapRule]) -> [CGFloat] {
        precondition(!rules.isEmpty, "至少要有一条缝")
        precondition(rules.allSatisfy { $0.minimum >= 0 && $0.weight >= 0 }, "下限与权重不得为负")
        var pinned = Set<Int>()
        while true {
            let open = rules.indices.filter { !pinned.contains($0) }
            let openWeight = open.reduce(0) { $0 + rules[$1].weight }
            guard openWeight > 0 else { break }
            let pinnedTotal = pinned.reduce(0) { $0 + rules[$1].minimum }
            let unit = max(0, free - pinnedTotal) / openWeight
            let starved = open.filter { unit * rules[$0].weight < rules[$0].minimum }
            if starved.isEmpty {
                return rules.indices.map { pinned.contains($0) ? rules[$0].minimum : unit * rules[$0].weight }
            }
            pinned.formUnion(starved)
        }
        return rules.map(\.minimum)
    }
}

/// 竖排：子项按声明序自上而下，子项之间与首尾共 `子项数 + 1` 条缝，缝宽由 `GapDistribution` 分。
///
/// **子项只取自身的理想高**，自由空间全部归缝——子项里谁想「撑满」都撑不开，余量归属不靠每一支自觉。
/// 列高取外层给的高与「子项 + 缝下限」两者较大者：外层给得不够时照常超出，由滚动容器吸收。
struct GapColumnLayout: Layout {
    let gaps: [GapRule]
    /// 按权重分完之后，从末缝挪到首缝的定量：整列内容下移这么多，末缝最多挪到它的下限为止。
    /// 不当作一份权重去分：那样会随屏高被稀释，下移量就不再是这个定值。
    var drop: CGFloat = 0

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        precondition(gaps.count == subviews.count + 1, "缝数必须是子项数 + 1")
        let width = proposal.width ?? subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
        let natural = contentHeight(subviews, width: width) + gaps.reduce(0) { $0 + $1.minimum }
        return CGSize(width: width, height: max(proposal.height ?? 0, natural))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)).height }
        let sizes = gapSizes(columnHeight: bounds.height, itemHeights: heights)
        var y = bounds.minY + sizes[0]
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(x: bounds.midX, y: y),
                anchor: .top,
                proposal: ProposedViewSize(width: bounds.width, height: heights[index])
            )
            y += heights[index] + sizes[index + 1]
        }
    }

    /// 列高扣掉各子项高，剩下的按 `gaps` 分给各缝，再从末缝挪 `drop` 到首缝，自上而下。
    func gapSizes(columnHeight: CGFloat, itemHeights: [CGFloat]) -> [CGFloat] {
        precondition(drop >= 0, "下移量不得为负")
        var sizes = GapDistribution.sizes(free: columnHeight - itemHeights.reduce(0, +), rules: gaps)
        let last = sizes.count - 1
        let moved = min(drop, max(0, sizes[last] - gaps[last].minimum))
        sizes[0] += moved
        sizes[last] -= moved
        return sizes
    }

    private func contentHeight(_ subviews: Subviews, width: CGFloat) -> CGFloat {
        subviews.reduce(0) { $0 + $1.sizeThatFits(ProposedViewSize(width: width, height: nil)).height }
    }
}
