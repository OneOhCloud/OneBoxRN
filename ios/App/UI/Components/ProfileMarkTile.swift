import SwiftUI
import Core

/// 站标砖：画什么由 `ProfileDestination.mark` 定。站标按比例内嵌、与砖同心，托底随脚下那一层（见 `ProfileMarkGround`）；
/// 回落字形是 `accent` 压 `accentContainer`。
///
/// 站标的结局按地址缓存在 `SiteIconCache`，再打开同一份详情不重打、也不先闪回落图标；
/// 去向换了（切换当前配置）即按新地址取，旧地址的结局不串到新砖上。
struct ProfileMarkTile: View {
    let destination: ProfileDestination
    let metrics: ProfileMarkTileMetrics
    let ground: ProfileMarkGround

    @State private var loaded: (address: String, entry: SiteIconCache.Entry)?

    var body: some View {
        let mark = destination.mark { SiteIconState(known($0)) }
        glyph(mark)
            .frame(width: metrics.side, height: metrics.side)
            .background(plate(mark), in: RoundedRectangle(cornerRadius: metrics.radius))
            .task(id: destination.iconAddress) {
                guard let iconAddress = destination.iconAddress else { return }
                loaded = (iconAddress, await SiteIconCache.shared.entry(for: iconAddress))
            }
    }

    @ViewBuilder
    private func glyph(_ mark: ProfileMark) -> some View {
        switch mark {
        case .siteIcon:
            loadedSiteIcon
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: metrics.siteIconSide, height: metrics.siteIconSide)
                .clipShape(RoundedRectangle(cornerRadius: metrics.siteIconRadius))
        case .globe:
            Image(systemName: "globe")
                .font(.system(size: metrics.globeGlyphSize, weight: .medium))
                .foregroundStyle(Theme.accent)
        case .brandMark:
            Image("brand_mark")
                .resizable()
                .scaledToFit()
                .frame(width: metrics.brandMarkSide, height: metrics.brandMarkSide)
                .foregroundStyle(Theme.accent)
        }
    }

    private func plate(_ mark: ProfileMark) -> Color {
        if case .siteIcon = mark { return ground.sitePlate }
        return Theme.accentContainer
    }

    private func known(_ address: String) -> SiteIconCache.Entry? {
        if let loaded, loaded.address == address { return loaded.entry }
        return SiteIconCache.shared.known(address)
    }

    /// 砖判成 `.siteIcon` 即缓存里已有这张图（`SiteIconState.loaded` 只从 `.icon` 折出来），这里必取得到。
    private var loadedSiteIcon: Image {
        guard let iconAddress = destination.iconAddress, case .icon(let image)? = known(iconAddress) else {
            preconditionFailure("site icon mark without a loaded icon")
        }
        return image
    }
}

/// 站标砖坐在什么上面。**入参是「面」，不是一个 `Bool`**（与 `Theme.SecondaryTextSurface` 同一取向）：
/// 调用点回答「我压在什么上面」，托底取什么色只在这里决定。
enum ProfileMarkGround {
    /// 页面底色上（配置详情头部）。
    case page
    /// 卡面上（配置卡）。
    case card

    /// 站标的托底：要与脚下那一层分得开。卡面本身就是 `surface`，同色托底会让砖形消失，
    /// 只剩一枚小站标，与地球、品牌标那两种砖不同大。
    var sitePlate: Color {
        switch self {
        case .page: Theme.surface
        case .card: Theme.fill
        }
    }
}

/// 站标砖的尺寸账：边长与圆角由调用方从主题取，砖内各项按详情头部那块 `64` 砖的比例随边长导出。
struct ProfileMarkTileMetrics: Equatable {
    let side: CGFloat
    let radius: CGFloat

    /// 配置详情头部：`64`，`Radius.panel`。
    static let detailHeader = ProfileMarkTileMetrics(side: 64, radius: Theme.Radius.panel)

    /// 基准砖 `64` 上：托底 `12`（站标内嵌 `40`）、地球 `28`、品牌标 `36`。
    private static let referenceSide: CGFloat = 64
    private static let referenceInset: CGFloat = 12
    private static let referenceGlobeGlyph: CGFloat = 28
    private static let referenceBrandMark: CGFloat = 36

    /// 站标与砖边之间留出的托底：小尺寸 favicon 居中而不拉满，透明底与低分辨率都不难看。
    var inset: CGFloat { scaled(Self.referenceInset) }
    var siteIconSide: CGFloat { side - 2 * inset }
    /// 与砖同心：外圆角减去托底。
    var siteIconRadius: CGFloat { radius - inset }
    var globeGlyphSize: CGFloat { scaled(Self.referenceGlobeGlyph) }
    var brandMarkSide: CGFloat { scaled(Self.referenceBrandMark) }

    private func scaled(_ reference: CGFloat) -> CGFloat {
        reference * side / Self.referenceSide
    }
}
