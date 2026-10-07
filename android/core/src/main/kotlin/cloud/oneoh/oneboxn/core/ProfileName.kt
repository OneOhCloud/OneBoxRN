package cloud.oneoh.oneboxn.core

// 导入 profile 展示名推导：Content-Disposition → 既有名 → URL 末段 → 主机名 → "Profile"。
// fromContentDisposition 手写等价 RN 正则 filename[^;=\n]*=((['"]).*?\2|[^;\n]*)——
// 两端手写同一扫描以保逐字一致，不依赖各自正则引擎。
// 与 iOS Core/ProfileName.swift 逐字对应，golden/profile-name.json 是行为裁判。
object ProfileName {
    /**
     * 从 Content-Disposition 头解析文件名：兼容 filename= 与 filename*=；取首个匹配值，
     * 剥除全部单双引号，再 percent 解码——解码失败保留原文
     * （有意差异：RN 未捕获解码异常会中断流水线，本仓不中断）。
     * 无匹配或值剥引号后为空 → ""（空串 = 该来源缺失）。
     */
    fun fromContentDisposition(header: String): String {
        var searchFrom = 0
        while (true) {
            val keyword = header.indexOf("filename", searchFrom)
            if (keyword < 0) return ""
            val value = matchValueAfterKeyword(header, keyword + "filename".length)
            if (value != null) {
                val stripped = value.filter { it != '\'' && it != '"' }
                return if (stripped.isEmpty()) "" else UrlInfo.percentDecodeOrOriginal(stripped)
            }
            searchFrom = keyword + 1
        }
    }

    /**
     * 四级回退（空串 = 该来源缺失）：Content-Disposition 文件名 → 同 URL 既有 profile 名
     * → URL 路径末段（不去扩展名）→ 主机名 → 字面量 "Profile"。
     */
    fun derive(contentDisposition: String, existingName: String, url: String): String {
        val headerName = fromContentDisposition(contentDisposition)
        if (headerName.isNotEmpty()) return headerName
        if (existingName.isNotEmpty()) return existingName
        val segment = UrlInfo.lastSegment(url)
        if (segment.isNotEmpty()) return segment
        val host = UrlInfo.hostname(url)
        if (host.isNotEmpty()) return host
        return "Profile"
    }

    /**
     * 镜像正则在单个 "filename" 起点上的匹配：[^;=\n]* 之后必须紧跟 '='；
     * 值优先按引号分支 (['"]).*?\2 匹配（同引号闭合、不跨行终止符），否则裸值分支 [^;\n]*（可为空）。
     * 该起点不满足 '=' 前置 → null（镜像正则在此起点匹配失败、继续下一起点；本文件内部唯一 null 信号）。
     */
    private fun matchValueAfterKeyword(header: String, from: Int): String? {
        var i = from
        while (i < header.length && header[i] != ';' && header[i] != '=' && header[i] != '\n') i++
        if (i >= header.length || header[i] != '=') return null
        i++
        // 引号分支：正则 '.' 不匹配行终止符，闭合引号须在同一行内；含引号返回，调用方统一剥引号。
        if (i < header.length && (header[i] == '"' || header[i] == '\'')) {
            val quote = header[i]
            var close = i + 1
            while (close < header.length && header[close] != quote && header[close] != '\n' && header[close] != '\r') close++
            if (close < header.length && header[close] == quote) {
                return header.substring(i, close + 1)
            }
        }
        // 裸值分支：取到 ';' 或换行为止。
        var end = i
        while (end < header.length && header[end] != ';' && header[end] != '\n') end++
        return header.substring(i, end)
    }
}
