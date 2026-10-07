// 下载内容准入：响应体存储前的三重判定——非空、可解析 JSON、顶层为对象。
// 与 Android core/ConfigCheck.kt 逐字对应，golden/config-check.json 是行为裁判。
// JsonError 是外部输入的解析失败，在此边界 catch 转类型化领域结果。

public enum ContentReject: Sendable, Equatable {
    case empty
    case notJson
    case notObject
}

public enum ConfigVerdict: Sendable, Equatable {
    case valid
    case invalid(ContentReject)
}

public enum ConfigCheck {
    /// trim 仅用于空判定；解析用原文——BOM 前缀因此被 Json.parse 拒 → notJson（镜像 JS JSON.parse）。
    public static func validate(_ content: String) -> ConfigVerdict {
        if isBlank(content) { return .invalid(.empty) }
        let parsed: JsonValue
        do {
            parsed = try Json.parse(content)
        } catch {
            return .invalid(.notJson)
        }
        guard case .jsonObject = parsed else { return .invalid(.notObject) }
        return .valid
    }

    // 空判定只认 JSON 空白四字符：两端原生 trim 的 Unicode 空白集不一致（如 U+00A0），自实现保证对等。
    private static func isBlank(_ content: String) -> Bool {
        content.unicodeScalars.allSatisfy { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }
    }
}
