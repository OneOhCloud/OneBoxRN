import Foundation

// 三源载荷解析：OS 深链 / 二维码文本 / 手输文本共用的唯一解析器。
// 纯函数：无 IO、无时钟、无平台依赖；与 Android core/ImportLink.kt 逐字对应，golden/import-link.json 是行为裁判。
// 四种拒因均为类型化领域错误（一切输入皆外部，本模块无崩溃类）。

public struct ImportPayload: Sendable, Hashable {
    public let url: String
    public let requestedApply: Bool

    public init(url: String, requestedApply: Bool) {
        self.url = url
        self.requestedApply = requestedApply
    }
}

public enum LinkReject: Sendable, Equatable {
    case notLink
    case missingData
    case badBase64
    case notHttps
}

public enum LinkVerdict: Sendable, Equatable {
    case accepted(ImportPayload)
    case rejected(LinkReject)
}

public enum ImportLink {
    // scheme 字面量全仓唯一出处 = 本文件（此外仅两端 OS 注册清单，OS 语法所需）。
    private static let schemePrefix = "oneoh-networktools://config"
    private static let httpsPrefix = "https://"

    /// 三分支识别（大小写敏感）：先去首尾 ASCII 空白，再判前缀——scheme 链接按深链格式解析；
    /// 裸 https 直接接受；其余拒绝 notLink。
    ///
    /// 去空白在**解析器内部**：粘贴来的链接常带尾随换行，若交由各入口自行 trim，就会出现
    /// 一端去、另一端不去。空白集显式限定为四个 ASCII 字符，
    /// 与导入输入的空判定同一集合——两端原生 trim 的 Unicode 空白集不一致（如 U+00A0）。
    public static func parse(_ rawInput: String) -> LinkVerdict {
        let raw = trimmedAsciiWhitespace(rawInput)
        if raw.hasPrefix(schemePrefix) { return parseSchemeLink(raw) }
        if raw.hasPrefix(httpsPrefix) {
            return .accepted(ImportPayload(url: raw, requestedApply: false))
        }
        return .rejected(.notLink)
    }

    private static func trimmedAsciiWhitespace(_ text: String) -> String {
        let scalars = text.unicodeScalars
        func isSpace(_ s: Unicode.Scalar) -> Bool { s == " " || s == "\t" || s == "\n" || s == "\r" }
        var start = scalars.startIndex
        var end = scalars.endIndex
        while start < end, isSpace(scalars[start]) { start = scalars.index(after: start) }
        while end > start, isSpace(scalars[scalars.index(before: end)]) { end = scalars.index(before: end) }
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }

    // 查询串取 data 与 apply，data 经 forgiving-base64 + 严格 UTF-8 还原为 url；
    // apply 恰为 "1" 才 true，缺失或其它值一律 false（不报错、不告警）。
    private static func parseSchemeLink(_ raw: String) -> LinkVerdict {
        let pairs = parseQuery(raw)
        guard let data = firstValue(pairs, "data"), !data.isEmpty else {
            return .rejected(.missingData)
        }
        guard let bytes = decodeForgivingBase64(data) else { return .rejected(.badBase64) }
        guard let url = String(bytes: bytes, encoding: .utf8) else {
            // 外部输入的解码失败在边界立即转类型化领域错误。
            return .rejected(.badBase64)
        }
        if !url.hasPrefix(httpsPrefix) { return .rejected(.notHttps) }
        return .accepted(ImportPayload(url: url, requestedApply: firstValue(pairs, "apply") == "1"))
    }

    // 首个 '?' 之后为查询串（无 '?' 即无参数）：按 & 拆对、首个 = 拆键值、两侧各自 percent 解码。
    // 有意差异：'+' 不视为空格——RN 经 URLSearchParams 会做该转换并破坏含未编码 '+' 的载荷，
    // 实际流通载荷均经 percent 编码，本仓不复制该缺陷。
    private static func parseQuery(_ raw: String) -> [(key: String, value: String)] {
        guard let questionIndex = raw.firstIndex(of: "?") else { return [] }
        let query = raw[raw.index(after: questionIndex)...]
        return query.split(separator: "&", omittingEmptySubsequences: false).map { pair -> (key: String, value: String) in
            guard let equalsIndex = pair.firstIndex(of: "=") else {
                return (percentDecode(String(pair)), "")
            }
            return (
                percentDecode(String(pair[..<equalsIndex])),
                percentDecode(String(pair[pair.index(after: equalsIndex)...]))
            )
        }
    }

    /// 同键多现取首个；键缺失是一等领域状态（本文件仅此处与 base64 失败信号允许 nil）。
    private static func firstValue(_ pairs: [(key: String, value: String)], _ key: String) -> String? {
        pairs.first { $0.key == key }?.value
    }

    // 严格 %XX（两位 ASCII 十六进制）逐字节还原后整体按严格 UTF-8 解码；
    // 任何非法序列（% 后不足两位十六进制、或还原字节非合法 UTF-8）→ 该值整体保留原样不解码。
    private static func percentDecode(_ component: String) -> String {
        let scalars = Array(component.unicodeScalars)
        var bytes: [UInt8] = []
        bytes.reserveCapacity(scalars.count)
        var i = 0
        while i < scalars.count {
            if scalars[i] == "%" {
                if i + 3 > scalars.count { return component }
                guard let hi = hexDigit(scalars[i + 1]), let lo = hexDigit(scalars[i + 2]) else {
                    return component
                }
                bytes.append(UInt8(hi * 16 + lo))
                i += 3
            } else {
                let start = i
                while i < scalars.count && scalars[i] != "%" { i += 1 }
                bytes.append(contentsOf: Array(String(String.UnicodeScalarView(scalars[start..<i])).utf8))
            }
        }
        guard let decoded = String(bytes: bytes, encoding: .utf8) else { return component }
        return decoded
    }

    // WHATWG forgiving-base64（对齐 atob）：先移除全部 ASCII 空白；仅标准字母表 A-Za-z0-9+/ 与
    // 尾部至多 2 个 =（URL-safe 的 -_ 或其它字符即失败）；剥 = 后剩余长度 %4==1 失败；
    // 末组按位解码：容忍缺 padding、非规范尾位不强校验。手写实现：平台 Base64 类两端容忍度不一，无法逐字对应。
    private static func decodeForgivingBase64(_ text: String) -> [UInt8]? {
        var kept: [Unicode.Scalar] = []
        kept.reserveCapacity(text.unicodeScalars.count)
        for c in text.unicodeScalars {
            if c != " " && c != "\t" && c != "\n" && c != "\u{0C}" && c != "\r" { kept.append(c) }
        }
        var length = kept.count
        var padding = 0
        while padding < 2 && length > 0 && kept[length - 1] == "=" {
            length -= 1
            padding += 1
        }
        if length % 4 == 1 { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(length * 3 / 4)
        var buffer = 0
        var bits = 0
        for i in 0..<length {
            guard let value = alphabetValue(kept[i]) else { return nil }
            buffer = ((buffer << 6) | value) & 0xFFFF
            bits += 6
            if bits >= 8 {
                bits -= 8
                bytes.append(UInt8((buffer >> bits) & 0xFF))
            }
        }
        return bytes
    }

    private static func alphabetValue(_ c: Unicode.Scalar) -> Int? {
        switch c.value {
        case 0x41...0x5A: return Int(c.value - 0x41)        // 'A'-'Z'
        case 0x61...0x7A: return Int(c.value - 0x61) + 26   // 'a'-'z'
        case 0x30...0x39: return Int(c.value - 0x30) + 52   // '0'-'9'
        case 0x2B: return 62                                 // '+'
        case 0x2F: return 63                                 // '/'
        default: return nil
        }
    }

    // 只认 ASCII 十六进制位，规避各平台「全角/其他数字」宽容差异（同 Json 解析器纪律）。
    private static func hexDigit(_ c: Unicode.Scalar) -> Int? {
        switch c.value {
        case 0x30...0x39: return Int(c.value - 0x30)
        case 0x61...0x66: return Int(c.value - 0x61 + 10)
        case 0x41...0x46: return Int(c.value - 0x41 + 10)
        default: return nil
        }
    }
}
