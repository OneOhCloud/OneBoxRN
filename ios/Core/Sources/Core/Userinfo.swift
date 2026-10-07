import Foundation

// 用量响应头解析纯函数：从头值中独立提取 upload/download/total/expire 四字段。
// 每字段取首个「key=十进制数字串」匹配，且 key 左侧须为串首或非字母数字字符（reupload= 不算 upload=）；
// 缺失或畸形（无匹配、数字串超出 Int64 范围）→ 0；expire 为 Unix 纪元秒，解析器不换算。
// 与 Android core/Userinfo.kt 逐字对应，golden/userinfo.json 是行为裁判。

public struct TrafficInfo: Sendable, Equatable {
    public let upload: Int64
    public let download: Int64
    public let total: Int64
    public let expire: Int64

    public init(upload: Int64, download: Int64, total: Int64, expire: Int64) {
        self.upload = upload
        self.download = download
        self.total = total
        self.expire = expire
    }
}

public enum Userinfo {
    /// 对外协议契约（非本仓命名，比照 UA 豁免处置）：配置服务端用量响应头名，全仓唯一出处；头名匹配的大小写不敏感由抓取端口保证。
    public static let HEADER = "subscription-userinfo"

    public static func parse(_ header: String) -> TrafficInfo {
        let scalars = Array(header.unicodeScalars)
        return TrafficInfo(
            upload: firstValue(scalars, "upload"),
            download: firstValue(scalars, "download"),
            total: firstValue(scalars, "total"),
            expire: firstValue(scalars, "expire")
        )
    }

    // 首个结构匹配即定值：匹配处数字串超出 Int64 范围按畸形处置 → 0，不再向后找。
    private static func firstValue(_ scalars: [Unicode.Scalar], _ key: String) -> Int64 {
        let needle = Array("\(key)=".unicodeScalars)
        var at = 0
        while at + needle.count <= scalars.count {
            let candidate = at
            at += 1
            if !startsWith(scalars, needle, at: candidate) { continue }
            // 左边界：串首或非字母数字字符，避免 reupload= 误配 upload=。
            if candidate > 0 && isAsciiAlphanumeric(scalars[candidate - 1]) { continue }
            let digitsStart = candidate + needle.count
            var end = digitsStart
            while end < scalars.count && isAsciiDigit(scalars[end]) { end += 1 }
            // '=' 后无数字（负号/小数点不算数字串起始）：本候选不成立，继续向后找。
            if end == digitsStart { continue }
            let digits = String(String.UnicodeScalarView(scalars[digitsStart..<end]))
            return Int64(digits) ?? 0
        }
        return 0
    }

    private static func startsWith(_ scalars: [Unicode.Scalar], _ needle: [Unicode.Scalar], at start: Int) -> Bool {
        for (offset, expected) in needle.enumerated() {
            if scalars[start + offset] != expected { return false }
        }
        return true
    }

    private static func isAsciiDigit(_ c: Unicode.Scalar) -> Bool {
        c.value >= 0x30 && c.value <= 0x39
    }

    // 只认 ASCII 字母数字，规避各平台 Unicode 分类宽容差异。
    private static func isAsciiAlphanumeric(_ c: Unicode.Scalar) -> Bool {
        isAsciiDigit(c) || (c.value >= 0x61 && c.value <= 0x7A) || (c.value >= 0x41 && c.value <= 0x5A)
    }
}
