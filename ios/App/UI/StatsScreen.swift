import SwiftUI
import Core

// 运行统计页：入/出站连接数卡片对在前，
// 其后是引擎内存独立区（数值 + 60 秒趋势 + 峰值）与网速区。数据与主页速率行同源同拍（同一 Traffic 快照）；
// 未连接走空态而非展示陈旧数字。趋势与峰值由会话级持有者供给，页面进出不清零。
struct ConnectionCardState: Identifiable, Equatable {
    let labelKey: String
    let value: String

    var id: String { labelKey }
}

/// 连接数卡片对的顺序权威（两端必须同序，Android 对手方 ui/StatsScreenTest.kt 的 `connectionCards`）。
/// 连接数为纯整数不加单位；上下行数字随图归网速区，不占本卡片对。
func connectionCards(connectionsIn: String, connectionsOut: String) -> [ConnectionCardState] {
    [
        ConnectionCardState(labelKey: "stats_conn_in", value: connectionsIn),
        ConnectionCardState(labelKey: "stats_conn_out", value: connectionsOut),
    ]
}

struct StatsScreen: View {
    @State private var vm: StatsViewModel

    init(actions: AppActions) {
        _vm = State(initialValue: StatsViewModel(actions: actions))
    }

    var body: some View {
        content
            .screenBackground()
            .navigationTitle(tr("stats_title"))
            .navigationBarTitleDisplayMode(.inline)
            .contentSwapTransition(vm.connected)
    }

    @ViewBuilder
    private var content: some View {
        if vm.connected {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    // 已连接不代表读数是新的。断流期整页转占位，并显式说明为什么没有数字
                    // ——只把数字换成「—」而不给理由，用户读到的是「坏了」而不是「暂时没有数据」。
                    if vm.stale { stalledNote }
                    // 连接数在前：两个瞬时整数读一眼就走，两块随时间演化的图排在其后。
                    // `.top` 对齐 + 卡片内 maxHeight 撑满 + 外层 fixedSize：两张卡等高，
                    // 且高度只取两者中更高的那个自然高度，不随外层可用空间一起长高。
                    HStack(alignment: .top, spacing: Theme.Spacing.medium) {
                        ForEach(connectionCards(connectionsIn: vm.connectionsIn, connectionsOut: vm.connectionsOut)) { card in
                            connectionCard(label: tr(card.labelKey), value: card.value)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    memoryCard
                    speedCard
                    // 页脚注记：说明内存读数的口径，并给出更省内存的选择（与 OneBoxNative 的有意差异）。
                    Text(tr("stats_engine_memory_note"))
                        .font(Theme.TypeScale.subtitle)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .pageInsets(top: Theme.Spacing.large)
            }
        } else {
            // 未连接时 Traffic 停在最后一帧，故整页走空态，绝不展示陈旧数字。
            EmptyState(
                systemImage: "power",
                title: tr("stats_disconnected"),
                caption: tr("stats_disconnected_note")
            )
            // 水平边距由**页**供给。
            .padding(.horizontal, Theme.Spacing.large)
        }
    }

    // 断流提示：不是错误弹层，只是一行如实说明——隧道照常转发，停的是观察通道。
    private var stalledNote: some View {
        HStack(spacing: Theme.Spacing.small) {
            Image(systemName: "wifi.exclamationmark")
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(Theme.textSecondary)
            Text(tr("stats_stalled"))
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.medium)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
        .accessibilityElement(children: .combine)
    }

    // 内存区：全页唯一的英雄数字 + 最近 60 秒走势 + 会话峰值。
    // 内存无上限/配额，故不做百分比仪表，只给绝对量与走势参照。
    private var memoryCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionLabel(text: tr("stats_memory"))
            // 全页唯一的最强数字（一页只有一个最强数字）。等宽数字防抖动。
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.extraSmall) {
                Text(vm.memoryParts.value)
                    // 数值 `22/600` 等宽。
                    .font(Theme.TypeScale.pageTitle.monospacedDigit())
                    .foregroundStyle(Theme.textPrimary)
                Text(vm.memoryParts.unit)
                    .font(Theme.TypeScale.status)
                    .foregroundStyle(Theme.textSecondary)
            }
            MemorySparkline(trend: vm.memoryTrend, peakLabel: vm.memoryPeak)
            HStack {
                Text(tr("stats_window"))
                    .font(Theme.TypeScale.meta)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text(tr("stats_memory_peak", vm.memoryPeak))
                    .font(Theme.TypeScale.meta.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(Theme.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    // 网速区：同基线双色面积图 + 下载/上传读数。
    // 两条共用同一归一分母，故高度比恒等于两个速率之比。
    private var speedCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            HStack {
                SectionLabel(text: tr("stats_speed"))
                Spacer()
                // 标题行右端的注记：`11` **大写** `textSecondary`，与内存区标题同档
                // （Android `sectionLabel` + `uppercase()`）。不报标题语义，故走注记变体。
                SectionAnnotation(text: tr("stats_window"))
            }
            SpeedAreaChart(trend: vm.rateTrend, upLabel: vm.uploadRate, downLabel: vm.downloadRate)
            // 左下载、右上传（先看下载）；与主页速率行同序。
            HStack {
                speedReadout(systemImage: "arrow.down", label: tr("stats_download_rate"), value: vm.downloadRate)
                Spacer()
                speedReadout(systemImage: "arrow.up", label: tr("stats_upload_rate"), value: vm.uploadRate)
            }
        }
        .padding(Theme.Spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    // 方向由图标表达，不只靠位置或颜色；数值等宽防抖动。
    private func speedReadout(systemImage: String, label: String, value: String) -> some View {
        HStack(spacing: Theme.Spacing.small) {
            Image(systemName: systemImage)
                // 箭头图标 `11`、**字重 600** ⇒ `sectionLabel`（不是 11/500 的 `meta`）。
                .font(Theme.TypeScale.sectionLabel)
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(Theme.TypeScale.subtitle.monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(value)
    }

    // 连接数卡片：展示态不可点；值用等宽数字（每秒刷新，非等宽会抖动）。
    // 两张卡靠 maxWidth: .infinity 等分，故数值位数变化不改变卡片宽度。
    private func connectionCard(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
            SectionLabel(text: label)
            // `15/500` 等宽：值每秒刷新，非等宽会抖动。它刻意**不与内存数字竞争**——
            // 排第一位的是阅读顺序，不是视觉权重。
            Text(value)
                .font(Theme.TypeScale.rowTitleEmphasis.monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
        }
        .padding(Theme.Spacing.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .cardSurface()
        .accessibilityElement(children: .combine)
    }
}

// 网速同基线双色面积图：两条都自底边向上生长、靠颜色区分，
// 共享同一归一分母，故两条高度比恒等于两个速率之比。
//
// 用普通 `Shape` 而不是 `Canvas`：后者会把整条 Metal 渲染路径拉起来，进页瞬间多出几十 MB 图形内存。
private struct SpeedAreaChart: View {
    let trend: TrafficRateTrend
    let upLabel: String
    let downLabel: String

    private static let height: CGFloat = 72
    /// 归一分母的顶部余量系数：与内存柱同款，峰值不顶满容器。
    private static let headroom: Double = 1.2

    var body: some View {
        // **先两条填充、后两条描边**：值小的那条整个落在大的那条区间内是常态，
        // 若逐条「填充完就描边」，后画的填充会把先画的描边盖住，小的那条照样看不见。
        // 层序固定（上传的填充在下载之上），不随谁大谁小换层——换层会让图在两帧间跳。
        ZStack {
            RateAreaShape(trend: trend, ceiling: ceiling, series: .download, closedToBaseline: true)
                // 面积填充色由描边色派生，两条序列同一档；不表达状态。
                .fill(Theme.chartDownload.opacity(Self.fillOpacity))
            RateAreaShape(trend: trend, ceiling: ceiling, series: .upload, closedToBaseline: true)
                // 面积填充色由描边色派生，两条序列同一档；不表达状态。
                .fill(Theme.chartUpload.opacity(Self.fillOpacity))
            RateAreaShape(trend: trend, ceiling: ceiling, series: .download, closedToBaseline: false)
                .stroke(Theme.chartDownload, lineWidth: Self.strokeWidth)
            RateAreaShape(trend: trend, ceiling: ceiling, series: .upload, closedToBaseline: false)
                .stroke(Theme.chartUpload, lineWidth: Self.strokeWidth)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.height)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control))
        .accessibilityElement()
        .accessibilityLabel(tr("stats_speed_trend"))
        .accessibilityValue("\(downLabel), \(upLabel)")
    }

    /// 两条序列的填充不透明度：跨端视觉契约，不由各端自选。
    private static let fillOpacity: Double = 0.35
    private static let strokeWidth: CGFloat = 2

    private var ceiling: Double { Double(trend.peak) * Self.headroom }
}

// 单个序列的面积路径：逐段闭合（断流留白——跨越缺口的连线会把没有数据的那段
// 画成「一直在跑」）。x 按样本时刻定位，y 按共享分母归一，两条同一基线。
private struct RateAreaShape: Shape {
    enum Series {
        case upload
        case download
    }

    let trend: TrafficRateTrend
    let ceiling: Double
    let series: Series
    /// true = 闭合到基线的面积（用于填充）；false = 只到曲线顶缘的轮廓（用于描边）。
    /// 两者共用同一条曲线，故填充与描边逐像素对齐。
    let closedToBaseline: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard ceiling > 0 else { return path }
        let span = Double(TrafficRateTrend.windowMillis)
        let windowStart = trend.windowStartMillis

        for segment in trend.segments() where segment.count >= 2 {
            // 归一坐标交给 core 平滑，像素映射留在这里：曲线形状是两端必须一致的可观察结果，
            // 各画各的必然背离且肉眼看不出（夹具 curve-smoothing.json）。
            let normalized = segment.map { sample -> CurvePoint in
                let value = series == .upload ? sample.up : sample.down
                return CurvePoint(
                    x: min(max(Double(sample.atMillis - windowStart) / span, 0), 1),
                    y: min(Double(value) / ceiling, 1)
                )
            }
            guard let first = normalized.first else { continue }
            let curve = CurveSmoothing.smooth(normalized)
            guard !curve.isEmpty else { continue }

            let start = point(first, in: rect)
            if closedToBaseline {
                path.move(to: CGPoint(x: start.x, y: rect.maxY))
                path.addLine(to: start)
            } else {
                path.move(to: start)
            }
            for piece in curve {
                path.addCurve(
                    to: point(piece.end, in: rect),
                    control1: point(piece.control1, in: rect),
                    control2: point(piece.control2, in: rect)
                )
            }
            if closedToBaseline {
                path.addLine(to: CGPoint(x: point(curve[curve.count - 1].end, in: rect).x, y: rect.maxY))
                path.closeSubpath()
            }
        }
        return path
    }

    /// 归一坐标 → 像素：两条序列同一映射、同一基线，没有方向分支。
    private func point(_ normalized: CurvePoint, in rect: CGRect) -> CGPoint {
        CGPoint(
            x: rect.minX + CGFloat(normalized.x) * rect.width,
            y: rect.maxY - CGFloat(normalized.y) * rect.height
        )
    }
}

// 趋势柱条：每拍一根柱（离散，不插值），按样本时刻定位、最新在右，缓冲未满时左侧留空。
// 柱高按**窗口**峰值归一（内存无绝对上限，参照只能是窗口自身）；无障碍播报的峰值
// 用展示层峰值串（会话峰值，降级窗口峰值）——两个峰值分属两个语义，不混用。
private struct MemorySparkline: View {
    let trend: MemoryTrend
    let peakLabel: String

    var body: some View {
        MemoryBarsShape(bars: trend.bars(), peak: trend.peak)
            .fill(Theme.accent)
            .frame(height: MemoryBarsShape.height)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control))
            .accessibilityElement()
            .accessibilityLabel(tr("stats_memory_trend"))
            .accessibilityValue(
                TrafficFormat.bytes(trend.samples.last?.bytes ?? 0)
                    + ", " + tr("stats_memory_peak", peakLabel)
            )
    }
}

// 全部柱走一条 `Path`，而不是 `Canvas`：Canvas 会把整条 Metal 渲染路径拉起来，
// 为一条 48pt 高的迷你柱图不值得。也不是 `HStack` + 六十个 `RoundedRectangle`：柱子按时刻
// 定位后位置不再等分，布局排不出来；一条 Path 顺带让 `bars()` 与 `peak` 每帧各只求一次。
private struct MemoryBarsShape: Shape {
    let bars: [MemoryBar]
    let peak: Int64

    static let height: CGFloat = 48
    private static let barGap: CGFloat = 1
    private static let barRadius: CGFloat = 2
    private static let minBarHeight: CGFloat = 2
    /// 柱高归一的顶部余量系数：分母取窗口峰值的 1.2 倍。
    private static let headroom: CGFloat = 1.2

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard peak > 0 else { return path }
        let barCount = CGFloat(MemoryTrend.barCount)
        let barWidth = (rect.width - Self.barGap * (barCount - 1)) / barCount
        // 归一分母 = 窗口峰值 × 1.2：顶部留两成余量，峰值柱才不会顶满容器
        // ——顶满时看不出「这一根就是峰值」，也没有再涨的视觉空间。
        let ceiling = CGFloat(peak) * Self.headroom
        let span = CGFloat(MemoryTrend.windowMillis)
        for bar in bars {
            let barHeight = max(Self.minBarHeight, CGFloat(bar.bytes) / ceiling * rect.height)
            // 柱的**右缘**对齐样本时刻：最新一拍恒贴右边缘，缺帧的那几秒就是那么宽的
            // 一段空白。正在滑出窗口的柱由外层 clipShape 裁切，不做位置钳制。
            let right = rect.minX + CGFloat(bar.offsetMillis) / span * rect.width
            path.addRoundedRect(
                in: CGRect(
                    x: right - barWidth,
                    y: rect.maxY - barHeight,
                    width: barWidth,
                    height: barHeight),
                cornerSize: CGSize(width: Self.barRadius, height: Self.barRadius))
        }
        return path
    }
}
