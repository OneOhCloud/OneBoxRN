package cloud.oneoh.oneboxn.core

/**
 * 日志关键词过滤的判据。两端同名同义，由 `golden/log-keyword.json` 裁判。
 *
 * 只判「这一行的正文命不命中」，不认识行的级别、时刻与来源——那三者各有自己的过滤器，
 * 把它们混进关键词会让几个控件的语义互相打架。
 */
object LogKeywordFilter {
    /**
     * 关键词的归一：首尾剔除**四个 ASCII 空白**（空格 / 制表 / 换行 / 回车）。
     * 剔除后为空 = 不过滤（「只敲了几个空格」不该把列表清空）。
     *
     * **不用各端原生 trim**：两端的「空白」定义互不相同——
     *   U+0085 NEL：Kotlin `trim()` **保留**，Swift `.whitespacesAndNewlines` 裁掉；
     *   U+001C FS：Kotlin **裁掉**，Swift 保留。
     * 同一条关键词会在两端筛出不同的结果。
     *
     * 显式集合与本仓其余裁剪站点（`RulesViewModel.trimAsciiWhitespace`、
     * `ImportLink`）同一口径。
     */
    fun normalize(keyword: String): String {
        var start = 0
        var end = keyword.length
        while (start < end && isAsciiWhitespace(keyword[start])) start++
        while (end > start && isAsciiWhitespace(keyword[end - 1])) end--
        return keyword.substring(start, end)
    }

    private fun isAsciiWhitespace(c: Char): Boolean = c == ' ' || c == '\t' || c == '\n' || c == '\r'

    /**
     * 正文是否命中已归一的关键词。
     *
     * 大小写折叠取 **locale 无关**的 `lowercase()`，不用带 Locale 的重载：后者随系统语言变
     * （土耳其语的 `I` 是经典反例），同一份日志会在两台设备上筛出不同结果，golden 也就不再是裁判。
     */
    fun matches(message: String, keyword: String): Boolean {
        val needle = normalize(keyword)
        if (needle.isEmpty()) return true
        return message.lowercase().contains(needle.lowercase())
    }
}
