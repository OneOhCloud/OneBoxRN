import Foundation

// 配置服务在导入与刷新响应里经官网头下发的站点，以及它的站点图标地址。
// 头缺失或不是 http(s) 地址即没有站点：不回落到任何写死的站点。
// 手写判定而非平台 URL 类（理由同 UrlInfo）；空白与控制字符只认 ASCII 那一段，两端逐字一致。
// 与 Android core/ProfileWebsite.kt 逐字对应，golden/profile-website.json 是行为裁判。
public enum ProfileWebsite {
    /// 此头名属于配置服务的既有传输协议。
    public static let HEADER = "official-website"

    private static let http = "http://"
    private static let https = "https://"
    private static let iconPath = "/favicon.ico"

    /// 头值去首尾空白后是 http(s) 地址、主机段非空、中间不夹空白即为站点，原样保留；否则 nil。
    public static func parse(_ header: String) -> String? {
        let value = trimmingSpaceOrControl(header)
        let scheme: String
        if hasPrefixIgnoringCase(value, https) {
            scheme = https
        } else if hasPrefixIgnoringCase(value, http) {
            scheme = http
        } else {
            return nil
        }
        if value.unicodeScalars.contains(where: isSpaceOrControl) { return nil }
        let rest = value.unicodeScalars.dropFirst(scheme.unicodeScalars.count)
        let authority = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        return authority.isEmpty ? nil : value
    }

    /// 站点图标：只认 https；去掉查询与片段、再去尾斜杠，接 `/favicon.ico`。http 站点没有图标。
    public static func iconUrl(_ website: String) -> String? {
        guard hasPrefixIgnoringCase(website, https) else { return nil }
        var base = website.unicodeScalars.prefix { $0 != "?" && $0 != "#" }
        while base.last == "/" { base.removeLast() }
        return String(base) + iconPath
    }

    private static func hasPrefixIgnoringCase(_ value: String, _ prefix: String) -> Bool {
        value.lowercased().hasPrefix(prefix)
    }

    private static func isSpaceOrControl(_ scalar: Unicode.Scalar) -> Bool { scalar.value <= 0x20 }

    private static func trimmingSpaceOrControl(_ value: String) -> String {
        var scalars = value.unicodeScalars[...]
        while let first = scalars.first, isSpaceOrControl(first) { scalars.removeFirst() }
        while let last = scalars.last, isSpaceOrControl(last) { scalars.removeLast() }
        return String(scalars)
    }
}
