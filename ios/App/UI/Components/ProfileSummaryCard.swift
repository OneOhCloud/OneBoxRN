import SwiftUI
import Core

/// 配置卡：回答「现在用的是哪一份、用到哪天、还剩多少」。配置页顶上与首页未连接的组位用的是同一张。
///
/// 与首页另外两张卡同一副网格（`HomeCardGrid`）：上排站标砖 + 名称 + 到期，下排读数带是流量。
/// 放进首页组位时与会话卡同高，连上之后同一个位置原位换内容，电源砖不动。
/// 站标砖单独可点：点开去向（配置站点，没有站点时产品官网）；卡身点按做什么见 `ProfileCardBody`。
///
/// 站标砖叠在卡上而不是排在卡里：卡身可点时整块是一个按钮，按钮里再套按钮，读屏只停外面那一个。
/// 砖的位置由卡里那一格占位报上来（`MarkSlotAnchor`），两种排法（网格 / 无障碍字号竖排）共用。
struct ProfileSummaryCard: View {
    let profile: Profile
    /// 配置没有站点时站标砖的去向：与关于页「官网」行同一来源。
    let productWebsite: URL
    /// 圆角由所在那一页给：首页与首页别的卡同值，配置页与下面的列表卡同值。
    let cornerRadius: CGFloat
    let cardBody: ProfileCardBody

    @State private var siteOpenFailed = false
    /// 卡身按下：整卡连同叠在上面的站标砖一起压暗。砖是按钮外的兄弟，按下态得由按钮报上来。
    @State private var bodyPressed = false
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let now = Int64(Date().timeIntervalSince1970)
        face(now: now)
            .overlayPreferenceValue(MarkSlotAnchor.self) { slot in
                GeometryReader { proxy in
                    if let slot {
                        let rect = proxy[slot]
                        siteTile(side: rect.width)
                            .offset(x: rect.minX, y: rect.minY)
                    }
                }
            }
            .opacity(bodyPressed ? ButtonMetrics.pressedOpacity : 1)
            .alert(tr("settings_link_error"), isPresented: $siteOpenFailed) {}
    }

    /// 卡身：读屏一个停点，读「当前配置，名称」，值是用量与到期。可切换时它是一个按钮，并带提示。
    @ViewBuilder
    private func face(now: Int64) -> some View {
        let value = ProfileMetaText.spokenReadings(profile, now: now)
        switch cardBody {
        case .inert:
            surface(now: now)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spokenName)
                .accessibilityValue(value)
        case .switchesProfile(let action):
            Button(action: action) { surface(now: now) }
                .buttonStyle(PressReportingButtonStyle(isPressed: $bodyPressed, cornerRadius: cornerRadius))
                .accessibilityLabel(spokenName)
                .accessibilityValue(value)
                .accessibilityHint(ProfileMetaText.switchHint)
        }
    }

    private var spokenName: String { tr("home_profile") + ", " + profile.name }

    private func surface(now: Int64) -> some View {
        content(now: now).cardSurface(cornerRadius: cornerRadius)
    }

    /// 「›」只在卡身可点时画：与会话卡节点行尾那一枚同义——点开还有一层。
    @ViewBuilder
    private var chevron: some View {
        if case .switchesProfile = cardBody {
            HomeCardChevron()
                .padding(.leading, HomeCardMetrics.titleToChevron)
        }
    }

    @ViewBuilder
    private func content(now: Int64) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            stacked(now: now)
        } else {
            grid(now: now)
        }
    }

    /// 默认排法：与会话卡同一副网格，任何非无障碍字号下三张卡同高。
    private func grid(now: Int64) -> some View {
        HomeCardGrid { diameter in
            HStack(spacing: 0) {
                markSlot(side: diameter)
                VStack(alignment: .leading, spacing: HomeCardMetrics.nameToCaption) {
                    name.lineLimit(1)
                    expiryLine(now: now).lineLimit(1)
                }
                .padding(.leading, HomeCardMetrics.badgeToTitle)
                .frame(maxWidth: .infinity, alignment: .leading)
                chevron
            }
        } band: {
            quotaBand
        }
    }

    /// 无障碍字号：网格那一排放不下名称与数字，改竖排——砖单独一行（「›」在这一行的行尾），
    /// 名称、到期与流量都允许折行。
    private func stacked(now: Int64) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            HStack(spacing: 0) {
                markSlot(side: ProfileSummaryMetrics.stackedMarkSide)
                Spacer(minLength: 0)
                chevron
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                name.lineLimit(ProfileSummaryMetrics.stackedNameLineLimit)
                expiryLine(now: now)
            }
            stackedQuota
        }
        .padding(HomeCardMetrics.inset)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var name: some View {
        Text(profile.name)
            .font(HomeCardMetrics.nameType)
            .foregroundStyle(Theme.textPrimary)
    }

    /// 名称下那一行。即将到期与已到期带状态色，并且都配图标；字本身见 `ProfileMetaText.expiryCaption`。
    private func expiryLine(now: Int64) -> some View {
        let expiry = ProfileExpiry(expireTime: profile.expireTime, now: now)
        return HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.extraSmall) {
            if expiry.marksWarning {
                Image(systemName: "exclamationmark.circle.fill")
            }
            Text(ProfileMetaText.expiryCaption(profile, now: now))
        }
        .font(HomeCardMetrics.autoCaptionType.monospacedDigit())
        .foregroundStyle(expiry.captionInk.color)
    }

    /// 读数带：已用 / 总量在上，配额条贴带底。无配额（服务端未下发用量）时只留一句，贴带底，不画空条。
    @ViewBuilder
    private var quotaBand: some View {
        if profile.totalTraffic > 0 {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    usedReading
                    Spacer(minLength: Theme.Spacing.small)
                    quotaShare
                }
                .lineLimit(1)
                Spacer(minLength: 0)
                UsageGauge(used: profile.usedTraffic, total: profile.totalTraffic)
            }
        } else {
            noUsage
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        }
    }

    @ViewBuilder
    private var stackedQuota: some View {
        if profile.totalTraffic > 0 {
            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                usedReading
                quotaShare
                UsageGauge(used: profile.usedTraffic, total: profile.totalTraffic)
            }
        } else {
            noUsage
        }
    }

    /// 已用重、总量轻：两段字重不同，分开排。
    private var usedReading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(TrafficFormat.bytes(profile.usedTraffic))
                .font(ProfileSummaryMetrics.usedType.monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
            Text(ProfileMetaText.trafficSeparator + TrafficFormat.bytes(profile.totalTraffic))
                .font(ProfileSummaryMetrics.totalType.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
        }
    }

    /// 右端：百分比；用尽时换成「已用尽」——满格的红条是颜色这一条通道，还得有一句字。
    @ViewBuilder
    private var quotaShare: some View {
        if ProfileMetaText.isExhausted(profile) {
            Text(tr("usage_exhausted"))
                .font(ProfileSummaryMetrics.shareType)
                .foregroundStyle(Theme.error.fg)
        } else {
            Text(ProfileMetaText.percent(profile))
                .font(ProfileSummaryMetrics.shareType.monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
        }
    }

    private var noUsage: some View {
        Text(tr("usage_none"))
            .font(HomeCardMetrics.entryNoteType)
            .foregroundStyle(Theme.textSecondary)
    }

    /// 站标砖的那一格：只占位、报位置，砖本身由 `siteTile` 叠上去。
    private func markSlot(side: CGFloat) -> some View {
        Color.clear
            .frame(width: side, height: side)
            .anchorPreference(key: MarkSlotAnchor.self, value: .bounds) { $0 }
    }

    /// 读屏只停这块砖一次：角标并进砖的标签，不单独成停点；排在卡身之前读。
    private func siteTile(side: CGFloat) -> some View {
        let destination = ProfileDestination(website: profile.website, productWebsite: productWebsite)
        let badge = LinkBadgeMetrics(tileSide: side)
        return Button { openSite(destination.url) } label: {
            ProfileMarkTile(destination: destination, metrics: ProfileSummaryMetrics.mark(side: side), ground: .card)
                .overlay(alignment: .bottomTrailing) {
                    LinkBadge(metrics: badge)
                        .offset(x: badge.outset, y: badge.outset)
                        .accessibilityHidden(true)
                }
                .contentShape(OutsetRectangle(area: ProfileSummaryMetrics.hitArea(side: side)))
        }
        .buttonStyle(PressDimmingButtonStyle())
        .accessibilityLabel(destination.tileAccessibilityLabel)
        .accessibilityAddTraits(.isLink)
        .accessibilitySortPriority(1)
    }

    /// 系统浏览器打开去向；打不开时就地弹「无法打开链接」（同配置详情与设置页的外链行）。
    private func openSite(_ url: URL) {
        openURL(url, completion: linkOpenCompletion { siteOpenFailed = true })
    }
}

/// 卡身点按做什么。站标砖不在其列：它在哪里都外跳。
enum ProfileCardBody {
    /// 不可点、不画「›」：配置页（下面的列表就是切换入口），以及首页只有一份配置时。
    case inert
    /// 首页有两份以上配置时：点开配置切换弹层。
    case switchesProfile(() -> Void)
}

/// 卡身按钮只报按下态、自己不画：压暗落在整张卡上（连同按钮外的站标砖），透明度与首页导入卡、
/// 失败卡同一档（`ButtonMetrics.pressedOpacity`）。
private struct PressReportingButtonStyle: ButtonStyle {
    @Binding var isPressed: Bool
    let cornerRadius: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
            .onChange(of: configuration.isPressed) { _, pressed in isPressed = pressed }
    }
}

/// 站标砖那一格在卡里的位置。卡里至多一格；两种排法各报一次，同一时刻只有一种在场。
private struct MarkSlotAnchor: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil

    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = value ?? nextValue()
    }
}

/// 到期读数的墨色档。给档位而不直接给 `Color`：哪一档该带状态色要能单测，而主题色是动态色，比不了相等。
enum ExpiryInk: Equatable {
    case primary
    case secondary
    case warning
    case error

    var color: Color {
        switch self {
        case .primary: Theme.textPrimary
        case .secondary: Theme.textSecondary
        case .warning: Theme.warning.fg
        case .error: Theme.error.fg
        }
    }
}

extension ProfileExpiry {
    /// 到期那一行的墨色：只有即将到期与已到期带状态色（二者都配图标，见 `marksWarning`）。
    var captionInk: ExpiryInk {
        switch self {
        case .soon: .warning
        case .expired: .error
        case .none, .normal: .secondary
        }
    }

    /// 状态色不能是唯一通道：带状态色的两档前面加一枚感叹号。
    var marksWarning: Bool {
        switch self {
        case .soon, .expired: true
        case .none, .normal: false
        }
    }
}

extension ProfileDestination {
    /// 站标砖的读屏标签：配置站点读主机名；产品官网读「官网」——那个主机名是产品的，说不出这份配置的来历。
    var tileAccessibilityLabel: String {
        switch self {
        case .profileSite: hostname
        case .productWebsite: tr("settings_website")
        }
    }
}

/// 外跳角标：`accent` 圆底上一枚 `onAccent` 的 ↗，说「点这块砖去外面」。
private struct LinkBadge: View {
    let metrics: LinkBadgeMetrics

    var body: some View {
        Image(systemName: "arrow.up.right")
            .font(.system(size: metrics.glyphSize, weight: .bold))
            .foregroundStyle(Theme.onAccent)
            .frame(width: metrics.side, height: metrics.side)
            .background(Theme.accent, in: Circle())
    }
}

/// 站标砖的点按区：砖连同外扩的角标取外接方框，不足系统下限时四边等量扩到下限。
/// 扩出的部分只进命中、不进版式：名称的位置不动，点按区的右沿也停在名称之前。
struct LinkTileHitArea: Equatable {
    /// 点按区左上角在砖左上角之外多远。
    let leadingOutset: CGFloat
    /// 点按区右下角在砖右下角之外多远：角标的外扩也在里面。
    let trailingOutset: CGFloat
    let side: CGFloat

    init(tileSide: CGFloat, badgeOutset: CGFloat, minimumSide: CGFloat) {
        let covered = tileSide + badgeOutset
        let growth = max(0, (minimumSide - covered) / 2)
        leadingOutset = growth
        trailingOutset = badgeOutset + growth
        side = covered + 2 * growth
    }
}

/// 把砖的方框按 `LinkTileHitArea` 向外扩出的命中形状。
private struct OutsetRectangle: Shape {
    let area: LinkTileHitArea

    func path(in rect: CGRect) -> Path {
        Path(CGRect(
            x: rect.minX - area.leadingOutset,
            y: rect.minY - area.leadingOutset,
            width: rect.width + area.leadingOutset + area.trailingOutset,
            height: rect.height + area.leadingOutset + area.trailingOutset
        ))
    }
}

/// 外跳角标的尺寸：随砖边同比——`40` 砖上直径 `16`、↗ `8`，向右下各外扩 `4`。
struct LinkBadgeMetrics: Equatable {
    let side: CGFloat
    let glyphSize: CGFloat
    let outset: CGFloat

    private static let referenceTileSide: CGFloat = 40
    private static let referenceSide: CGFloat = 16
    private static let referenceGlyphSize: CGFloat = 8
    private static let referenceOutset: CGFloat = 4

    init(tileSide: CGFloat) {
        let scale = tileSide / Self.referenceTileSide
        side = Self.referenceSide * scale
        glyphSize = Self.referenceGlyphSize * scale
        outset = Self.referenceOutset * scale
    }
}

enum ProfileSummaryMetrics {
    /// 站标砖占首页卡圆位那一格，边随圆位一起放大（`HomeCardGrid` 的 `@ScaledMetric`）；
    /// 圆角同比跟上——不跟，砖放大后就读起来变方。默认字号下是 `control`。
    static func mark(side: CGFloat) -> ProfileMarkTileMetrics {
        ProfileMarkTileMetrics(side: side, radius: Theme.Radius.control * side / HomeCardMetrics.badgeDiameter)
    }

    /// 系统建议的最小点按区（HIG `44 × 44`），两端同值。
    static let minimumHitSide: CGFloat = 44

    static func hitArea(side: CGFloat) -> LinkTileHitArea {
        LinkTileHitArea(tileSide: side, badgeOutset: LinkBadgeMetrics(tileSide: side).outset, minimumSide: minimumHitSide)
    }

    /// 无障碍字号竖排时，砖取详情头部那一档单独一行；名称最多三行，再长才截断。
    static let stackedMarkSide = ProfileMarkTileMetrics.detailHeader.side
    static let stackedNameLineLimit = 3

    /// 读数带那一行：已用重、总量轻、右端百分比居中。与会话卡读数同一量级。
    static let usedType = Theme.TypeScale.rowTitle.weight(.semibold)
    static let totalType = Theme.TypeScale.status
    static let shareType = Theme.TypeScale.statusEmphasis
}
