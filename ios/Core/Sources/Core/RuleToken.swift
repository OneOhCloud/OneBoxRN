import Foundation

// 路由规则 token 的纯逻辑：三元组模型 + normalize + 三 kind 校验 + 批量拆分。
// 与 Android core/RuleToken.kt 逐字对应，golden/rule-token.json 是行为裁判。
// 校验唯一实现于此；纯函数：无 IO、无时钟、无平台依赖。

/// 规则动作。声明序即匹配优先级：引擎 first-match，reject > direct > proxy。
public enum RuleAction: Int, CaseIterable, Sendable {
    case reject, direct, proxy
}

/// 匹配类别。声明序即展示序。
public enum RuleKind: Int, CaseIterable, Sendable {
    case domain, domainSuffix, ipCidr
}

/// 规则 = 三元组，值相等即同一条规则，无独立 id。
public struct Rule: Sendable, Hashable {
    public let action: RuleAction
    public let kind: RuleKind
    public let value: String

    public init(action: RuleAction, kind: RuleKind, value: String) {
        self.action = action
        self.kind = kind
        self.value = value
    }
}

public enum RuleToken {
    /// trim + 小写；后续校验与存储均基于该结果。
    public static func normalize(_ raw: String) -> String {
        let scalars = Array(raw.unicodeScalars)
        var start = 0
        var end = scalars.count
        while start < end && isWhitespace(scalars[start]) { start += 1 }
        while end > start && isWhitespace(scalars[end - 1]) { end -= 1 }
        return String(String.UnicodeScalarView(scalars[start..<end])).lowercased()
    }

    /// value 是否为给定 kind 的合法 matcher（基于 normalize 后的值）。
    public static func validate(kind: RuleKind, value: String) -> Bool {
        switch kind {
        case .domain: return isDomain(value)
        case .domainSuffix: return isDomain(value.hasPrefix(".") ? String(value.dropFirst()) : value)
        case .ipCidr: return isIpCidr(value)
        }
    }

    /// 仅换行与逗号为分隔符（连续折叠）→ normalize → 去空串 → 保序去重（首现为准）。
    public static func parseBulk(_ text: String) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for piece in text.components(separatedBy: CharacterSet(charactersIn: "\n,")) {
            let token = normalize(piece)
            if token.isEmpty || !seen.insert(token).inserted { continue }
            out.append(token)
        }
        return out
    }

    // 空白集写死为四个 ASCII 空白：两端标准库 trim 对 NBSP 等归类不一，固定集合以保两端一致。
    private static func isWhitespace(_ c: Unicode.Scalar) -> Bool {
        c == " " || c == "\t" || c == "\n" || c == "\r"
    }

    // 按 '.' 分段后每段非空且仅含 [a-z0-9-]（允许前/后导连字符）；空串拆出单个空段，自然落败。
    private static func isDomain(_ value: String) -> Bool {
        value.components(separatedBy: ".").allSatisfy { segment in
            !segment.isEmpty && segment.unicodeScalars.allSatisfy(isDomainChar)
        }
    }

    private static func isDomainChar(_ c: Unicode.Scalar) -> Bool {
        (c >= "a" && c <= "z") || isDecimalDigit(c) || c == "-"
    }

    // 无斜杠须为纯 v4/v6 地址；有斜杠须为「地址 + 纯数字前缀」，v4 0–32、v6 0–128。
    private static func isIpCidr(_ value: String) -> Bool {
        guard let slash = value.firstIndex(of: "/") else { return isIpv4(value) || isIpv6(value) }
        let address = String(value[..<slash])
        let prefix = String(value[value.index(after: slash)...])
        if prefix.isEmpty || !prefix.unicodeScalars.allSatisfy(isDecimalDigit) { return false }
        guard let bits = Int(prefix) else { return false }
        if isIpv4(address) { return bits <= 32 }
        if isIpv6(address) { return bits <= 128 }
        return false
    }

    // 恰 4 段，每段 1–3 位十进制数字且 ≤255（允许前导零）。
    private static func isIpv4(_ address: String) -> Bool {
        let segments = address.components(separatedBy: ".")
        if segments.count != 4 { return false }
        return segments.allSatisfy { segment in
            let length = segment.unicodeScalars.count
            return length >= 1 && length <= 3
                && segment.unicodeScalars.allSatisfy(isDecimalDigit)
                && Int(segment)! <= 255
        }
    }

    // 含冒号；"::" 折叠至多一次；无折叠须恰 8 组，有折叠时显式组合计 ≤7（"::" 至少折叠一个全零组）。
    private static func isIpv6(_ address: String) -> Bool {
        if !address.contains(":") { return false }
        let halves = address.components(separatedBy: "::")
        if halves.count > 2 { return false }
        if halves.count == 2 {
            let left = halves[0].isEmpty ? [] : halves[0].components(separatedBy: ":")
            let right = halves[1].isEmpty ? [] : halves[1].components(separatedBy: ":")
            if !left.allSatisfy(isHextet) || !right.allSatisfy(isHextet) { return false }
            return left.count + right.count <= 7
        }
        let groups = address.components(separatedBy: ":")
        return groups.count == 8 && groups.allSatisfy(isHextet)
    }

    private static func isHextet(_ group: String) -> Bool {
        let length = group.unicodeScalars.count
        return length >= 1 && length <= 4 && group.unicodeScalars.allSatisfy(isHexDigit)
    }

    // hextet 只认小写十六进制：校验基于 normalize结果，与 domain 段的小写字面一致。
    private static func isHexDigit(_ c: Unicode.Scalar) -> Bool {
        isDecimalDigit(c) || (c >= "a" && c <= "f")
    }

    private static func isDecimalDigit(_ c: Unicode.Scalar) -> Bool {
        c >= "0" && c <= "9"
    }
}
