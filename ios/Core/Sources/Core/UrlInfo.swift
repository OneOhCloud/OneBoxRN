import Foundation

// URL 派生纯函数：主机名（域名验证与命名回退）与路径末段（命名回退）。
// 手写解析而非平台 URL 类——java.net.URI 与 Foundation.URL 语义不一，手写才能两端逐字一致。
// 与 Android core/UrlInfo.kt 逐字对应，golden/url-info.json 是行为裁判。
// 解析不出一律返回 ""（空串 = 领域缺省，域名验证的 fail-closed 依赖此约定），不抛错不返回 nil。
public enum UrlInfo {
    /// 主机名：小写；IPv6 字面量保留方括号（镜像 WHATWG URL.hostname）；带端口时剥端口。
    /// 无 "://"、主机为空、IPv6 括号不闭合 → ""。
    public static func hostname(_ url: String) -> String {
        guard let schemeEnd = url.range(of: "://") else { return "" }
        let afterScheme = url[schemeEnd.upperBound...]
        let authorityEnd = afterScheme.firstIndex { $0 == "/" || $0 == "?" || $0 == "#" } ?? afterScheme.endIndex
        let authority = afterScheme[..<authorityEnd]
        // 剥 userinfo：WHATWG 以最后一个 '@' 为界。
        let host = authority.lastIndex(of: "@").map { authority[authority.index(after: $0)...] } ?? authority
        if host.hasPrefix("[") {
            guard let close = host.firstIndex(of: "]") else { return "" }
            return String(host[...close]).lowercased()
        }
        let portStart = host.firstIndex(of: ":") ?? host.endIndex
        return String(host[..<portStart]).lowercased()
    }

    /// path + query，原样不解码（加速 URL 构造要逐字节转发）。fragment 不发给服务器，丢弃。
    /// path 为空补 "/"（`https://h?x=1` → `/?x=1`）；无 "://" → ""。
    public static func pathAndQuery(_ url: String) -> String {
        guard let schemeEnd = url.range(of: "://") else { return "" }
        let afterScheme = url[schemeEnd.upperBound...]
        let fragmentStart = afterScheme.firstIndex(of: "#") ?? afterScheme.endIndex
        let beforeFragment = afterScheme[..<fragmentStart]
        guard let authorityEnd = beforeFragment.firstIndex(where: { $0 == "/" || $0 == "?" }) else { return "/" }
        let rest = beforeFragment[authorityEnd...]
        return rest.hasPrefix("?") ? "/\(rest)" : String(rest)
    }

    /// path 末段：忽略 query/fragment 与尾斜杠空段；percent 解码，解码失败保留原文。
    /// 无 "://" 或无非空段 → ""。
    public static func lastSegment(_ url: String) -> String {
        guard let schemeEnd = url.range(of: "://") else { return "" }
        // query/fragment 不属于 path，先截掉。
        let afterScheme = url[schemeEnd.upperBound...]
        let queryStart = afterScheme.firstIndex { $0 == "?" || $0 == "#" } ?? afterScheme.endIndex
        let beforeQuery = afterScheme[..<queryStart]
        guard let pathStart = beforeQuery.firstIndex(of: "/") else { return "" }
        var path = beforeQuery[pathStart...]
        // 尾斜杠产生的空段忽略：先剥尾部 '/'，再取末段。
        while path.hasSuffix("/") { path = path.dropLast() }
        if path.isEmpty { return "" }
        let start = path.lastIndex(of: "/").map { path.index(after: $0) } ?? path.startIndex
        return percentDecodeOrOriginal(String(path[start...]))
    }

    /// percent 解码（%XX 字节流按 UTF-8 解码）；任何非法（坏十六进制/截断/非法 UTF-8）→ 保留原文返回。
    static func percentDecodeOrOriginal(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        var out = ""
        var pending: [Int] = [] // 连续 %XX 的字节缓冲，整段按 UTF-8 解码
        var i = 0
        while i < scalars.count {
            let c = scalars[i]
            if c == "%" {
                if i + 3 > scalars.count { return text }
                guard let hi = hexDigit(scalars[i + 1]), let lo = hexDigit(scalars[i + 2]) else { return text }
                pending.append(hi * 16 + lo)
                i += 3
            } else {
                if !flushUtf8(&pending, into: &out) { return text }
                out.unicodeScalars.append(c)
                i += 1
            }
        }
        if !flushUtf8(&pending, into: &out) { return text }
        return out
    }

    // 严格 UTF-8 解码 pending 追加到 out（拒绝截断/过长编码/代理区码点/超 U+10FFFF）；非法 → false，成功则清空 pending。
    private static func flushUtf8(_ pending: inout [Int], into out: inout String) -> Bool {
        var i = 0
        while i < pending.count {
            let b0 = pending[i]
            if b0 < 0x80 {
                out.unicodeScalars.append(Unicode.Scalar(UInt32(b0))!)
                i += 1
            } else if (0xC2...0xDF).contains(b0) {
                if i + 2 > pending.count { return false }
                let b1 = pending[i + 1]
                if !(0x80...0xBF).contains(b1) { return false }
                out.unicodeScalars.append(Unicode.Scalar(UInt32(((b0 & 0x1F) << 6) | (b1 & 0x3F)))!)
                i += 2
            } else if (0xE0...0xEF).contains(b0) {
                if i + 3 > pending.count { return false }
                let b1 = pending[i + 1]
                let b2 = pending[i + 2]
                let b1Min = b0 == 0xE0 ? 0xA0 : 0x80
                let b1Max = b0 == 0xED ? 0x9F : 0xBF
                if b1 < b1Min || b1 > b1Max || !(0x80...0xBF).contains(b2) { return false }
                out.unicodeScalars.append(Unicode.Scalar(UInt32(((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F)))!)
                i += 3
            } else if (0xF0...0xF4).contains(b0) {
                if i + 4 > pending.count { return false }
                let b1 = pending[i + 1]
                let b2 = pending[i + 2]
                let b3 = pending[i + 3]
                let b1Min = b0 == 0xF0 ? 0x90 : 0x80
                let b1Max = b0 == 0xF4 ? 0x8F : 0xBF
                if b1 < b1Min || b1 > b1Max || !(0x80...0xBF).contains(b2) || !(0x80...0xBF).contains(b3) { return false }
                out.unicodeScalars.append(Unicode.Scalar(UInt32(((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)))!)
                i += 4
            } else {
                return false
            }
        }
        pending.removeAll()
        return true
    }

    // 只认 ASCII 十六进制位，规避各平台宽容差异。
    private static func hexDigit(_ c: Unicode.Scalar) -> Int? {
        switch c.value {
        case 0x30...0x39: return Int(c.value - 0x30)
        case 0x61...0x66: return Int(c.value - 0x61 + 10)
        case 0x41...0x46: return Int(c.value - 0x41 + 10)
        default: return nil
        }
    }
}
