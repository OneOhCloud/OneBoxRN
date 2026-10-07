import Foundation

// 配置详情头部：点开去哪（去向），砖上画什么（图标）。与 Android core/ProfileDestination.kt 同口径，
// golden/profile-destination.json 是两端行为裁判。
// 「打得开」手写判定而非平台 URL 类（理由同 UrlInfo）：只认 http(s)、主机非空、端口段全是数字。

/// 配置详情头部点开以后去哪：服务端下发了站点就去配置站点，否则去产品官网。
public enum ProfileDestination: Equatable, Sendable {
    /// `iconAddress` 为 nil：这个站点不取站标（只认 https，见 `ProfileWebsite.iconUrl`）。
    case profileSite(URL, iconAddress: String?)
    case productWebsite(URL)

    /// 站点打不开（不是 http(s)、主机为空、端口不是数字）时也去产品官网：头部总得有一个打得开的去向。
    /// 存储读回时并不重新校验站点，所以这里是打开之前的最后一道。
    public init(website: String?, productWebsite: URL) {
        guard let website, Self.opensAsWebAddress(website), let url = URL(string: website) else {
            self = .productWebsite(productWebsite)
            return
        }
        self = .profileSite(url, iconAddress: ProfileWebsite.iconUrl(website))
    }

    public var url: URL {
        switch self {
        case .profileSite(let url, _), .productWebsite(let url): url
        }
    }

    /// 胶囊上的字：完整地址在点开之后的浏览器里，头部只写主机。
    public var hostname: String { UrlInfo.hostname(url.absoluteString) }

    /// 要取的站标地址；产品官网与 http 站点都没有。
    public var iconAddress: String? {
        guard case .profileSite(_, let iconAddress) = self else { return nil }
        return iconAddress
    }

    /// 砖上画什么：图标说的就是点开去哪。`known` 按图标地址给出站标缓存里已有的结局，只在有图标地址时才问。
    ///
    /// 不收超额：超额是用量的属性，信号落在用量上；头部是入口，换成警示号就看不出点开去哪。
    public func mark(known: (String) -> SiteIconState) -> ProfileMark {
        guard case .profileSite(_, let iconAddress) = self else { return .brandMark }
        guard let iconAddress else { return .globe }
        switch known(iconAddress) {
        case .loaded: return .siteIcon
        case .unknown, .unavailable: return .globe
        }
    }

    private static let webSchemes = ["https://", "http://"]

    private static func opensAsWebAddress(_ address: String) -> Bool {
        let lowered = address.lowercased()
        guard let scheme = webSchemes.first(where: { lowered.hasPrefix($0) }),
              !UrlInfo.hostname(address).isEmpty else { return false }
        let rest = address.dropFirst(scheme.count)
        let authority = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        let host = authority.lastIndex(of: "@").map { authority[authority.index(after: $0)...] } ?? authority
        return port(of: host).allSatisfy { ("0"..."9").contains($0) }
    }

    /// 端口段（不含冒号）。IPv6 字面量里的冒号不是端口分隔：括号闭合与否 `UrlInfo.hostname` 已判过。
    private static func port(of host: Substring) -> Substring {
        if host.hasPrefix("["), let close = host.firstIndex(of: "]") {
            let afterBracket = host[host.index(after: close)...]
            return afterBracket.hasPrefix(":") ? afterBracket.dropFirst() : afterBracket
        }
        return host.firstIndex(of: ":").map { host[host.index(after: $0)...] } ?? ""
    }
}

/// 站标地址在缓存里的已知结局。core 不碰图像：图像留在 App 层的缓存里，这里只认结局。
public enum SiteIconState: Equatable, Sendable {
    /// 还没有结局：没取过，或正在取。
    case unknown
    case loaded
    case unavailable
}

/// 站标砖的内容：站标，或按去向回落的两枚字形之一。
public enum ProfileMark: Equatable, Sendable {
    case siteIcon
    /// 配置站点的站标还在取、取不到，或站点是 http 不取。
    case globe
    /// 去向是产品官网。
    case brandMark
}
