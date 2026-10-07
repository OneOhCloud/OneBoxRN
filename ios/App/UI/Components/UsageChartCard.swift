import SwiftUI
import Core

// 账本某一档的卡片（汇总三项 + 柱图 + 起止刻度）。用量页与配置页的今日图共用同一件：
// 两处画的是同一种东西，各画一份必然在柱高归一、零值处置、刻度取端这三处慢慢分叉。
//
// 选中态是本件的内部状态：点某一格 → 汇总三项与刻度行改述该格，再点或
// 点图外空白取消；换档 / 换 profile 时随 series 一起重来。它不上抛、不持久化，故两处各自独立。
struct UsageChartCard: View {
    let series: UsageSeries
    let tier: UsageTier

    @State private var selected: Int?

    private var cell: UsageCell? {
        guard let selected, series.cells.indices.contains(selected) else { return nil }
        return series.cells[selected]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            // **`spacing: 0` 不是可省的**：`HStack` 的默认间距会在三列之间插出槽，而 Android 那份是零槽。
            HStack(alignment: .top, spacing: 0) {
                summaryItem(
                    label: tr("device_usage_upload"),
                    value: TrafficFormat.bytes(cell?.up ?? series.totalUp)
                )
                summaryItem(
                    label: tr("device_usage_download"),
                    value: TrafficFormat.bytes(cell?.down ?? series.totalDown)
                )
                summaryItem(
                    label: tr("device_usage_sum"),
                    value: TrafficFormat.bytes(
                        cell.map { $0.up + $0.down } ?? (series.totalUp + series.totalDown)
                    )
                )
            }
            UsageBars(
                series: series,
                tier: tier,
                selected: selected,
                onTapCell: { index in selected = selected == index ? nil : index },
                onStepTo: { index in selected = index < 0 ? nil : index }
            )
            // 选中时刻度行整行改述该格；未选中时回到首末格两端。行数与字阶不变，卡片高度恒定。
            HStack {
                if let cell {
                    Text(UsageScaleLabel.range(of: cell, tier: tier))
                        .font(Theme.TypeScale.meta.monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                } else {
                    Text(UsageScaleLabel.of(series.cells.first?.startHourUtc, tier: tier))
                        .font(Theme.TypeScale.meta.monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Text(UsageScaleLabel.of(series.cells.last?.startHourUtc, tier: tier))
                        .font(Theme.TypeScale.meta.monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .padding(Theme.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
        // 图外空白取消选中：柱图自己的手势先消费落在图上的点按，这里只收剩下的。
        .contentShape(Rectangle())
        .onTapGesture { selected = nil }
        // 换档 / 换 profile 即重来：原来那一格已不存在。
        .onChange(of: series) { selected = nil }
        .onChange(of: tier) { selected = nil }
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func summaryItem(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Theme.TypeScale.meta)
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(Theme.TypeScale.rowTitleEmphasis.monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
        }
        // 等分并排：用 `Spacer()` 会得到等距、内容宽的列，选中一格后三项文字变短，列位置就跟着动。
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// 柱图：每格一根柱（离散区间量，形态同内存柱）；区间内全为 0 时不画柱——
// 画一排最小高度的柱会让「没用过」看着像「用了一点」。
//
// 选中态的区分**全部交给轨道顶端那条标记**，柱色不参与。
//
// **颜色这条路是被算死的**：对比度沿亮度轴严格可乘 ⇒
// 「选中:未选中」×「未选中:轨道」≡「选中:轨道」，而右边被 `accent` 与 `fill`
// 两个令牌钉死在 `5.05`（明亮）/ `3.50`（暗色）⇒ 未选中一旦过非文本门槛 `3:1`，
// 两态之间最多只剩 `1.68` / `1.17` ⇒ **区分不可能只靠颜色，换哪个令牌都不行。**
// 也不用 `textSecondary`：它是为「文字压在暗底上要可读」定的，暗色下是亮的，
// 拿来画图形的轻重在暗色下方向相反。
//
// **标记挂轨道顶端而不是柱顶**：柱高随数值变，**零值格根本没有柱**
// （零值格同样可选中）⇒ 挂柱上的标记恰在最需要它的那一格缺席。
private struct UsageBars: View {
    let series: UsageSeries
    let tier: UsageTier
    let selected: Int?
    let onTapCell: (Int) -> Void
    let onStepTo: (Int) -> Void

    private static let height: CGFloat = 120
    private static let barGap: CGFloat = 1
    private static let barRadius: CGFloat = 2
    private static let minBarHeight: CGFloat = 2
    /// 柱高归一的顶部余量系数：与内存柱同款，峰值不顶满容器。
    private static let headroom: Double = 1.2
    /// 轨道顶端那条选中标记：高 `4`、圆角 `2`、距轨顶 `4`、宽同柱。
    private static let markerHeight: CGFloat = 4
    private static let markerRadius: CGFloat = 2
    private static let markerTopInset: CGFloat = 4
    /// 可调整语义里「未选中」的取值：与 Android 侧同一约定。
    private static let noSelection = -1

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                HStack(alignment: .bottom, spacing: Self.barGap) {
                    ForEach(Array(series.cells.enumerated()), id: \.offset) { item in
                        // **柱色恒 `accent`，不随选中分档**：分档那条路已被上面那段算死。
                        RoundedRectangle(cornerRadius: Self.barRadius)
                            .fill(Theme.accent)
                            .frame(maxWidth: .infinity)
                            .frame(height: barHeight(of: item.element))
                    }
                }
                .frame(width: proxy.size.width, height: Self.height, alignment: .bottom)

                // 标记与柱**共用同一套布局**（同样的 `barGap` + 每列 `maxWidth: .infinity`）：
                // 自己按索引算 x 会和柱的等分算法慢慢分叉，而那种偏移肉眼比对不出来。
                // 未选中的列放 `Color.clear` 而不是不放——列必须恒占位，否则标记会跑位。
                //
                // 标记是**唯一**的状态通道，它一旦与柱的等分算法分叉，错的就是唯一那条指示。
                HStack(spacing: Self.barGap) {
                    ForEach(Array(series.cells.enumerated()), id: \.offset) { item in
                        Group {
                            if selected == item.offset {
                                RoundedRectangle(cornerRadius: Self.markerRadius)
                                    .fill(Theme.accent)
                            } else {
                                Color.clear
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: Self.markerHeight)
                    }
                }
                .padding(.top, Self.markerTopInset)
                .frame(width: proxy.size.width)
            }
            .frame(width: proxy.size.width, height: Self.height, alignment: .bottom)
            .contentShape(Rectangle())
            // 命中判据走 core 单一来源：两端布局不同（这里等分容器、Android 手算宽度），
            // 各算各的会让边界那一格落到不同格上，而这种背离肉眼比对不出来。
            //
            // 用 onTapGesture 而不是 minimumDistance 0 的 DragGesture：后者会把从图上起手的
            // 拖动整个吃掉，页面就再也滚不动了——而这块图有 120pt 高、横跨整张卡片。
            //「这一按在不在图上」由本修饰符的作用域保证，core 的钳制只兜边缘的一两像素越界。
            .onTapGesture(coordinateSpace: .local) { location in
                guard !series.cells.isEmpty, proxy.size.width > 0 else { return }
                onTapCell(
                    UsageChartHit.index(
                        fractionX: Double(location.x / proxy.size.width),
                        cellCount: series.cells.count
                    )
                )
            }
        }
        .frame(height: Self.height)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control))
        .accessibilityElement()
        .accessibilityLabel(tr("device_usage_chart"))
        .accessibilityValue(accessibilityValue)
        .accessibilityHint(tr("device_usage_chart_hint"))
        // 整图一个元素、但**可调整**：读屏没有坐标，只挂提示等于点不动。
        // 「未选中」取 -1，与 Android 侧可调整语义的区间下界逐字相同：把未选中伪装成第 0 格
        // 会让读屏第一次「增加」跳过首格；-1 同时给了读屏一条取消选中的路。
        .accessibilityAdjustableAction { direction in
            let count = series.cells.count
            guard count >= 2 else { return }
            let current = selected ?? Self.noSelection
            switch direction {
            case .increment: onStepTo(min(current + 1, count - 1))
            case .decrement: onStepTo(max(current - 1, Self.noSelection))
            @unknown default: break
            }
        }
    }

    /// 未选中播报区间合计，选中播报该格的时间范围与三个数。
    private var accessibilityValue: String {
        guard let selected, series.cells.indices.contains(selected) else {
            return TrafficFormat.bytes(series.totalUp + series.totalDown)
        }
        let cell = series.cells[selected]
        return [
            UsageScaleLabel.range(of: cell, tier: tier),
            "\(tr("device_usage_upload")) \(TrafficFormat.bytes(cell.up))",
            "\(tr("device_usage_download")) \(TrafficFormat.bytes(cell.down))",
            "\(tr("device_usage_sum")) \(TrafficFormat.bytes(cell.up + cell.down))",
        ].joined(separator: ", ")
    }

    private var ceiling: Double {
        Double(series.cells.map { $0.up + $0.down }.max() ?? 0) * Self.headroom
    }

    private func barHeight(of cell: UsageCell) -> CGFloat {
        let total = cell.up + cell.down
        guard total > 0, ceiling > 0 else { return 0 }
        return max(Self.minBarHeight, CGFloat(Double(total) / ceiling) * Self.height)
    }
}

// 刻度：两端都取所在格的**起始**时刻——右端若取末格的结束时刻，今日会写成次日 00:00
// （与左端字面相同，读起来像坏了），近 30 天 / 半年则会写出一个明天的日期。
// 今日给起止小时，其余给起止日期；两者都经固定 locale 的唯一构造点。
enum UsageScaleLabel {
    private static let dayFormatter = fixedFormatDateFormatter("yyyy-MM-dd")
    private static let hourFormatter = fixedFormatDateFormatter("HH:mm")

    static func of(_ hourUtc: Int64?, tier: UsageTier) -> String {
        guard let hourUtc else { return "" }
        let date = Date(timeIntervalSince1970: TimeInterval(hourUtc * 3600))
        return tier == .today ? hourFormatter.string(from: date) : dayFormatter.string(from: date)
    }

    /// 选中格的时间范围：这里**要**用结束时刻——它是「这一格覆盖到哪」的答案，
    /// 而上面那条刻度是「图从哪开始 / 到哪结束」的答案，两者是不同的问题。
    /// 结束边界是开区间，故日期档回退一小时落在该格最后一天上。
    static func range(of cell: UsageCell, tier: UsageTier) -> String {
        let start = Date(timeIntervalSince1970: TimeInterval(cell.startHourUtc * 3600))
        switch tier {
        case .today:
            let end = Date(timeIntervalSince1970: TimeInterval(cell.endHourUtc * 3600))
            return "\(hourFormatter.string(from: start)) – \(hourFormatter.string(from: end))"
        case .month:
            return dayFormatter.string(from: start)
        case .halfYear:
            let end = Date(timeIntervalSince1970: TimeInterval((cell.endHourUtc - 1) * 3600))
            return "\(dayFormatter.string(from: start)) – \(dayFormatter.string(from: end))"
        }
    }
}
