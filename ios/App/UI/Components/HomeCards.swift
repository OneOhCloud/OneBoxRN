import SwiftUI
import Core

/// 首页组位里的卡：已连接是会话卡，未连接是配置卡（`ProfileSummaryCard`），启动失败是失败卡。
/// 三张卡同宽同高、同一副网格，组位按这一个高度预留，四态之间电源砖不动。
enum HomeCardMetrics {
    static let inset: CGFloat = 16
    static let radius = Theme.Radius.panel
    static let badgeDiameter: CGFloat = 44
    static let badgeToTitle: CGFloat = 12
    static let chevronSize: CGFloat = 13
    static let rowToBand: CGFloat = 16
    static let bandHeight: CGFloat = 36
    static let nameType = Theme.TypeScale.sheetTitle
    static let autoCaptionType = Theme.TypeScale.subtitle
    static let readoutType = Theme.TypeScale.subtitle
    static let cellValueType = Theme.TypeScale.emptyTitle.monospacedDigit()
    static let cellLabelType = Theme.TypeScale.meta
    static let entryTitleType = Theme.TypeScale.emptyTitle
    static let entryNoteType = Theme.TypeScale.status
    static let digitSize: CGFloat = 15
    static let unitSize: CGFloat = 9
    static let titleToChevron = Theme.Spacing.small
    static let noteToChevron = Theme.Spacing.extraSmall
    static let nameToCaption: CGFloat = 2
    static let readoutIconSize: CGFloat = 10
    static let readoutIconToValue = Theme.Spacing.extraSmall
    static let cellGap = Theme.Spacing.small
    /// 读数带左格的宽度份额（中右两格各一份）：左格是箭头加速率，比纯数字宽一截。
    static let speedCellShare: CGFloat = 1.1
    /// 圆位里加号 / 感叹号占直径的比例。
    static let symbolRatio: CGFloat = 0.46
    /// 四位数降两号：按原字号排会顶到圆位边缘。
    static let fourDigitShrink: CGFloat = 2

    /// 默认字号下的卡高。
    static var height: CGFloat { inset * 2 + badgeDiameter + rowToBand + bandHeight }

    static func digitType(delayMs: Int) -> Theme.TypeStyle {
        Theme.TypeStyle(
            size: delayMs >= 1000 ? digitSize - fourDigitShrink : digitSize,
            trackingEm: -0.02,
            weight: .bold,
            usesMonospacedDigit: true,
            relativeTo: .footnote
        )
    }

    static let unitType = Theme.TypeStyle(size: unitSize, trackingEm: 0, weight: .semibold, relativeTo: .caption2)
    static let placeholderType = Theme.TypeStyle(size: digitSize, trackingEm: 0, weight: .semibold, relativeTo: .footnote)
}

/// 三张卡的共同网格：上排与圆位同高，下排是读数带。
///
/// 两排的高随动态字号一起放大，而三张卡都走这一副网格 ⇒ 任何字号下三张卡仍一样高，组位不跳。
struct HomeCardGrid<Top: View, Band: View>: View {
    @ScaledMetric(relativeTo: .footnote) private var badgeDiameter = HomeCardMetrics.badgeDiameter
    @ScaledMetric(relativeTo: .body) private var bandHeight = HomeCardMetrics.bandHeight
    @ViewBuilder let top: (_ badgeDiameter: CGFloat) -> Top
    @ViewBuilder let band: () -> Band

    var body: some View {
        VStack(alignment: .leading, spacing: HomeCardMetrics.rowToBand) {
            top(badgeDiameter)
                .frame(height: badgeDiameter)
            band()
                .frame(height: bandHeight)
        }
        .padding(HomeCardMetrics.inset)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 左上的圆位：节点卡里是延迟读数，失败卡里是入口图形；配置卡把这一格让给站标砖。三张卡同一个位置。
struct HomeCardBadge: View {
    enum Content {
        /// 节点延迟：圆位底色取档位容器色、字取档位前景色。
        case latency(LatencyReading)
        /// 入口图形：前景与圆位底色取同一对语义色。
        case symbol(systemName: String, tone: Theme.Tone)
    }

    let content: Content
    let diameter: CGFloat

    var body: some View {
        inner
            .frame(width: diameter, height: diameter)
            .background(tone.container, in: Circle())
    }

    @ViewBuilder
    private var inner: some View {
        switch content {
        case .latency(.measured(let delayMs, let tier)):
            VStack(spacing: 0) {
                Text(verbatim: String(delayMs))
                    .font(HomeCardMetrics.digitType(delayMs: delayMs))
                Text(verbatim: "ms")
                    .font(HomeCardMetrics.unitType)
            }
            .foregroundStyle(tier.tone.fg)
        case .latency(.testing):
            ProgressView()
                .controlSize(.small)
                .tint(Theme.textSecondary)
        case .latency(.unavailable):
            Text(verbatim: "—")
                .font(HomeCardMetrics.placeholderType)
                .foregroundStyle(Theme.textSecondary)
        case .symbol(let systemName, let tone):
            Image(systemName: systemName)
                .font(.system(size: diameter * HomeCardMetrics.symbolRatio, weight: .bold))
                .foregroundStyle(tone.fg)
        }
    }

    private var tone: Theme.Tone {
        switch content {
        case .latency(let reading): return reading.tier.tone
        case .symbol(_, let tone): return tone
        }
    }
}

/// 「›」：会话卡与配置卡跟在上排行尾，失败卡跟在说明之后，说的都是「点开还有一层」。
struct HomeCardChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: HomeCardMetrics.chevronSize, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
    }
}

/// 已连接：节点行在上，读数带在下（网速 · 本次时长 · 本次用量）。
struct SessionCard: View {
    struct Readings {
        let node: NodeNameLines
        let latency: LatencyReading
        let downloadRate: String
        let uploadRate: String
        let usage: String
        /// 系统记的本次连上时刻；不在会话里时为 nil。时长按它每秒现算。
        let startedAt: Date?
    }

    let readings: Readings
    let onSelectNode: () -> Void

    var body: some View {
        HomeCardGrid { diameter in
            Button(action: onSelectNode) {
                nodeRow(badgeDiameter: diameter)
            }
            .buttonStyle(PressDimmingStyle())
            // 圆位里的数字与「ms」是两段字，不给标签会分开读；整行读成一句：节点选择，完整名称，延迟。
            .accessibilityLabel(nodeLabel)
            .accessibilityIdentifier("home.node")
        } band: {
            GeometryReader { band in
                let share = (band.size.width - HomeCardMetrics.cellGap * 2) / (HomeCardMetrics.speedCellShare + 2)
                HStack(spacing: HomeCardMetrics.cellGap) {
                    speedCell
                        .frame(width: share * HomeCardMetrics.speedCellShare)
                    durationCell
                        .frame(width: share)
                    valueCell(value: readings.usage, label: tr("home_session_usage"))
                        .frame(width: share)
                }
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: HomeCardMetrics.radius))
    }

    private func nodeRow(badgeDiameter: CGFloat) -> some View {
        HStack(spacing: 0) {
            HomeCardBadge(content: .latency(readings.latency), diameter: badgeDiameter)
            VStack(alignment: .leading, spacing: HomeCardMetrics.nameToCaption) {
                Text(readings.node.name)
                    .font(HomeCardMetrics.nameType)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    // 节点名多是「地区 … 编号 / 倍率」，同地区的几个只在结尾不同：尾部省略会把它们截成同一串。
                    .truncationMode(.middle)
                if let caption = readings.node.autoCaption {
                    Text(caption)
                        .font(HomeCardMetrics.autoCaptionType)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            .padding(.leading, HomeCardMetrics.badgeToTitle)
            .frame(maxWidth: .infinity, alignment: .leading)
            HomeCardChevron()
                .padding(.leading, HomeCardMetrics.titleToChevron)
        }
    }

    private var nodeLabel: String {
        var parts = [tr("home_node_label")] + readings.node.spoken
        if case .measured(let delayMs, _) = readings.latency {
            parts.append(tr("nodes_delay", String(delayMs)))
        }
        return parts.joined(separator: ", ")
    }

    /// 左格：下行在上、上行在下，与运行统计页数值行同序。
    private var speedCell: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpeedReadout(
                systemImage: "arrow.down",
                value: readings.downloadRate,
                accessibility: tr("home_download", readings.downloadRate)
            )
            Spacer(minLength: 0)
            SpeedReadout(
                systemImage: "arrow.up",
                value: readings.uploadRate,
                accessibility: tr("home_upload", readings.uploadRate)
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// 不在会话里就不起秒表：卡此刻看不见，而一个每秒重算的时钟会一直跑着。
    @ViewBuilder
    private var durationCell: some View {
        let label = tr("home_session_duration")
        if let startedAt = readings.startedAt {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                valueCell(value: sessionDurationText(startedAt: startedAt, now: context.date), label: label)
            }
        } else {
            valueCell(value: StatsViewModel.placeholder, label: label)
        }
    }

    /// 中格与右格：大数字在上、小标题在下。读屏读成「标题，数值」。
    private func valueCell(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value)
                .font(HomeCardMetrics.cellValueType)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 0)
            Text(label)
                .font(HomeCardMetrics.cellLabelType)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(value)
    }
}

/// 速率读数：箭头 + 等宽数值（高频变化防跳动）。数值取次级色：大数字留给时长与用量。
private struct SpeedReadout: View {
    let systemImage: String
    let value: String
    let accessibility: String

    var body: some View {
        HStack(spacing: HomeCardMetrics.readoutIconToValue) {
            Image(systemName: systemImage)
                .font(.system(size: HomeCardMetrics.readoutIconSize, weight: .semibold))
            Text(value)
                .font(HomeCardMetrics.readoutType.monospacedDigit())
                .lineLimit(1)
        }
        .foregroundStyle(Theme.textSecondary)
        .accessibilityElement()
        .accessibilityLabel(accessibility)
    }
}

/// 启动失败的失败卡：整卡一个按钮。上排是图标位 + 标题，与会话卡的节点行同一副排法；
/// 说明带「›」贴读数带底边靠右——连上之后圆位里换成延迟读数、读数带里换成三格，位置都不动。
struct HomeEntryCard: View {
    struct Content {
        let systemImage: String
        let tone: Theme.Tone
        let title: String
        /// 标题色：失败卡的错误色只给图标与标题，说明与「›」仍是次要色。
        let titleColor: Color
        let note: String
    }

    let content: Content
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HomeCardGrid { diameter in
                HStack(spacing: 0) {
                    HomeCardBadge(
                        content: .symbol(systemName: content.systemImage, tone: content.tone),
                        diameter: diameter
                    )
                    Text(content.title)
                        .font(HomeCardMetrics.entryTitleType)
                        .foregroundStyle(content.titleColor)
                        .lineLimit(1)
                        .padding(.leading, HomeCardMetrics.badgeToTitle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } band: {
                HStack(spacing: HomeCardMetrics.noteToChevron) {
                    Text(content.note)
                        .font(HomeCardMetrics.entryNoteType)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    // 说明过长时让说明截尾，「›」不让出宽度。
                    HomeCardChevron()
                        .layoutPriority(1)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        .buttonStyle(HomeCardButtonStyle())
        // 显式标签：不给时读屏会把圆位里的图形与尾部的「›」按符号名一起念出来。
        .accessibilityLabel(content.title)
        .accessibilityHint(content.note)
    }
}

/// 整卡按钮的底与按压反馈。底取卡面色、不描边不投影；必须是 ButtonStyle，理由同 PrimaryButtonStyle。
private struct HomeCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: HomeCardMetrics.radius))
            .contentShape(RoundedRectangle(cornerRadius: HomeCardMetrics.radius))
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

/// 卡内节点行：底是卡的，按下只把这一行压暗。
private struct PressDimmingStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

extension NodeLatency.Tier {
    /// 档位 → 语义色对：阈值判定在 core `NodeLatency`，这里只做色映射。
    var tone: Theme.Tone {
        switch self {
        case .good: return Theme.success
        case .fair: return Theme.warning
        case .poor: return Theme.error
        case .none: return Theme.Tone(fg: Theme.textSecondary, container: Theme.fill)
        }
    }
}
