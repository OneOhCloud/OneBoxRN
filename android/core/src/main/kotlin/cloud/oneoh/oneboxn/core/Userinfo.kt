package cloud.oneoh.oneboxn.core

// 用量响应头解析纯函数：从头值中独立提取 upload/download/total/expire 四字段。
// 每字段取首个「key=十进制数字串」匹配，且 key 左侧须为串首或非字母数字字符（reupload= 不算 upload=）；
// 缺失或畸形（无匹配、数字串超出 Long 范围）→ 0；expire 为 Unix 纪元秒，解析器不换算。
// 与 iOS Core/Userinfo.swift 逐字对应，golden/userinfo.json 是行为裁判。

data class TrafficInfo(val upload: Long, val download: Long, val total: Long, val expire: Long)

object Userinfo {
    /** 对外协议契约（非本仓命名，比照 UA 豁免处置）：配置服务端用量响应头名，全仓唯一出处；头名匹配的大小写不敏感由抓取端口保证。 */
    const val HEADER = "subscription-userinfo"

    fun parse(header: String): TrafficInfo = TrafficInfo(
        upload = firstValue(header, "upload"),
        download = firstValue(header, "download"),
        total = firstValue(header, "total"),
        expire = firstValue(header, "expire"),
    )

    // 首个结构匹配即定值：匹配处数字串超出 Long 范围按畸形处置 → 0，不再向后找。
    private fun firstValue(header: String, key: String): Long {
        val needle = "$key="
        var at = 0
        while (at + needle.length <= header.length) {
            val candidate = at
            at++
            if (!header.startsWith(needle, candidate)) continue
            // 左边界：串首或非字母数字字符，避免 reupload= 误配 upload=。
            if (candidate > 0 && isAsciiAlphanumeric(header[candidate - 1])) continue
            val digitsStart = candidate + needle.length
            var end = digitsStart
            while (end < header.length && header[end] in '0'..'9') end++
            // '=' 后无数字（负号/小数点不算数字串起始）：本候选不成立，继续向后找。
            if (end == digitsStart) continue
            return header.substring(digitsStart, end).toLongOrNull() ?: 0L
        }
        return 0L
    }

    // 只认 ASCII 字母数字，规避各平台 Unicode 分类宽容差异。
    private fun isAsciiAlphanumeric(c: Char): Boolean =
        c in '0'..'9' || c in 'a'..'z' || c in 'A'..'Z'
}
