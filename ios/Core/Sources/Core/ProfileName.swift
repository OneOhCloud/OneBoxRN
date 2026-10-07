import Foundation

// 导入 profile 展示名推导：Content-Disposition → 既有名 → URL 末段 → 主机名 → "Profile"。
// fromContentDisposition 手写等价 RN 正则 filename[^;=\n]*=((['"]).*?\2|[^;\n]*)——
// 两端手写同一扫描以保逐字一致，不依赖各自正则引擎。
// 与 Android core/ProfileName.kt 逐字对应，golden/profile-name.json 是行为裁判。
public enum ProfileName {
    /// 从 Content-Disposition 头解析文件名：兼容 filename= 与 filename*=；取首个匹配值，
    /// 剥除全部单双引号，再 percent 解码——解码失败保留原文
    /// （有意差异：RN 未捕获解码异常会中断流水线）。
    /// 无匹配或值剥引号后为空 → ""（空串 = 该来源缺失）。
    public static func fromContentDisposition(_ header: String) -> String {
        var searchFrom = header.startIndex
        while let keywordRange = header.range(of: "filename", range: searchFrom..<header.endIndex) {
            if let value = matchValueAfterKeyword(header, keywordRange.upperBound) {
                let stripped = String(value.filter { $0 != "'" && $0 != "\"" })
                return stripped.isEmpty ? "" : UrlInfo.percentDecodeOrOriginal(stripped)
            }
            searchFrom = header.index(after: keywordRange.lowerBound)
        }
        return ""
    }

    /// 四级回退（空串 = 该来源缺失）：Content-Disposition 文件名 → 同 URL 既有 profile 名
    /// → URL 路径末段（不去扩展名）→ 主机名 → 字面量 "Profile"。
    public static func derive(contentDisposition: String, existingName: String, url: String) -> String {
        let headerName = fromContentDisposition(contentDisposition)
        if !headerName.isEmpty { return headerName }
        if !existingName.isEmpty { return existingName }
        let segment = UrlInfo.lastSegment(url)
        if !segment.isEmpty { return segment }
        let host = UrlInfo.hostname(url)
        if !host.isEmpty { return host }
        return "Profile"
    }

    /// 镜像正则在单个 "filename" 起点上的匹配：[^;=\n]* 之后必须紧跟 '='；
    /// 值优先按引号分支 (['"]).*?\2 匹配（同引号闭合、不跨行终止符），否则裸值分支 [^;\n]*（可为空）。
    /// 该起点不满足 '=' 前置 → nil（镜像正则在此起点匹配失败、继续下一起点；本文件内部唯一 nil 信号）。
    private static func matchValueAfterKeyword(_ header: String, _ from: String.Index) -> String? {
        var i = from
        while i < header.endIndex && header[i] != ";" && header[i] != "=" && header[i] != "\n" { i = header.index(after: i) }
        if i >= header.endIndex || header[i] != "=" { return nil }
        i = header.index(after: i)
        // 引号分支：正则 '.' 不匹配行终止符，闭合引号须在同一行内；含引号返回，调用方统一剥引号。
        if i < header.endIndex && (header[i] == "\"" || header[i] == "'") {
            let quote = header[i]
            var close = header.index(after: i)
            while close < header.endIndex && header[close] != quote && header[close] != "\n" && header[close] != "\r" {
                close = header.index(after: close)
            }
            if close < header.endIndex && header[close] == quote {
                return String(header[i...close])
            }
        }
        // 裸值分支：取到 ';' 或换行为止。
        var end = i
        while end < header.endIndex && header[end] != ";" && header[end] != "\n" { end = header.index(after: end) }
        return String(header[i..<end])
    }
}
