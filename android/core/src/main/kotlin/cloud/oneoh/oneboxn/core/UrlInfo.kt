package cloud.oneoh.oneboxn.core

// URL 派生纯函数：主机名（域名验证与命名回退）与路径末段（命名回退）。
// 手写解析而非平台 URL 类——java.net.URI 与 Foundation.URL 语义不一，手写才能两端逐字一致。
// 与 iOS Core/UrlInfo.swift 逐字对应，golden/url-info.json 是行为裁判。
// 解析不出一律返回 ""（空串 = 领域缺省，域名验证的 fail-closed 依赖此约定），不抛错不返回 null。
object UrlInfo {
    /**
     * 主机名：小写；IPv6 字面量保留方括号（镜像 WHATWG URL.hostname）；带端口时剥端口。
     * 无 "://"、主机为空、IPv6 括号不闭合 → ""。
     */
    fun hostname(url: String): String {
        val schemeEnd = url.indexOf("://")
        if (schemeEnd < 0) return ""
        val afterScheme = url.substring(schemeEnd + 3)
        val authorityEnd = afterScheme.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val authority = if (authorityEnd < 0) afterScheme else afterScheme.substring(0, authorityEnd)
        // 剥 userinfo：WHATWG 以最后一个 '@' 为界。
        val host = authority.substringAfterLast('@')
        if (host.startsWith("[")) {
            val close = host.indexOf(']')
            if (close < 0) return ""
            return host.substring(0, close + 1).lowercase()
        }
        return host.substringBefore(':').lowercase()
    }

    /**
     * path + query，原样不解码（加速 URL 构造要逐字节转发）。fragment 不发给服务器，丢弃。
     * path 为空补 "/"（`https://h?x=1` → `/?x=1`）；无 "://" → ""。
     */
    fun pathAndQuery(url: String): String {
        val schemeEnd = url.indexOf("://")
        if (schemeEnd < 0) return ""
        val afterScheme = url.substring(schemeEnd + 3)
        val fragmentStart = afterScheme.indexOf('#')
        val beforeFragment = if (fragmentStart < 0) afterScheme else afterScheme.substring(0, fragmentStart)
        val authorityEnd = beforeFragment.indexOfFirst { it == '/' || it == '?' }
        if (authorityEnd < 0) return "/"
        val rest = beforeFragment.substring(authorityEnd)
        return if (rest.startsWith("?")) "/$rest" else rest
    }

    /**
     * path 末段：忽略 query/fragment 与尾斜杠空段；percent 解码，解码失败保留原文。
     * 无 "://" 或无非空段 → ""。
     */
    fun lastSegment(url: String): String {
        val schemeEnd = url.indexOf("://")
        if (schemeEnd < 0) return ""
        // query/fragment 不属于 path，先截掉。
        val afterScheme = url.substring(schemeEnd + 3)
        val queryStart = afterScheme.indexOfFirst { it == '?' || it == '#' }
        val beforeQuery = if (queryStart < 0) afterScheme else afterScheme.substring(0, queryStart)
        val pathStart = beforeQuery.indexOf('/')
        if (pathStart < 0) return ""
        var path = beforeQuery.substring(pathStart)
        // 尾斜杠产生的空段忽略：先剥尾部 '/'，再取末段。
        while (path.endsWith("/")) path = path.dropLast(1)
        if (path.isEmpty()) return ""
        val start = path.lastIndexOf('/') + 1
        return percentDecodeOrOriginal(path.substring(start))
    }

    /** percent 解码（%XX 字节流按 UTF-8 解码）；任何非法（坏十六进制/截断/非法 UTF-8）→ 保留原文返回。 */
    internal fun percentDecodeOrOriginal(text: String): String {
        val sb = StringBuilder()
        val pending = mutableListOf<Int>() // 连续 %XX 的字节缓冲，整段按 UTF-8 解码
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '%') {
                if (i + 3 > text.length) return text
                val hi = hexDigit(text[i + 1]) ?: return text
                val lo = hexDigit(text[i + 2]) ?: return text
                pending.add(hi * 16 + lo)
                i += 3
            } else {
                if (!flushUtf8(pending, sb)) return text
                sb.append(c)
                i++
            }
        }
        if (!flushUtf8(pending, sb)) return text
        return sb.toString()
    }

    // 严格 UTF-8 解码 pending 追加到 sb（拒绝截断/过长编码/代理区码点/超 U+10FFFF）；非法 → false，成功则清空 pending。
    private fun flushUtf8(pending: MutableList<Int>, sb: StringBuilder): Boolean {
        var i = 0
        while (i < pending.size) {
            val b0 = pending[i]
            when {
                b0 < 0x80 -> {
                    sb.append(b0.toChar())
                    i += 1
                }
                b0 in 0xC2..0xDF -> {
                    if (i + 2 > pending.size) return false
                    val b1 = pending[i + 1]
                    if (b1 !in 0x80..0xBF) return false
                    sb.appendCodePoint(((b0 and 0x1F) shl 6) or (b1 and 0x3F))
                    i += 2
                }
                b0 in 0xE0..0xEF -> {
                    if (i + 3 > pending.size) return false
                    val b1 = pending[i + 1]
                    val b2 = pending[i + 2]
                    val b1Min = if (b0 == 0xE0) 0xA0 else 0x80
                    val b1Max = if (b0 == 0xED) 0x9F else 0xBF
                    if (b1 < b1Min || b1 > b1Max || b2 !in 0x80..0xBF) return false
                    sb.appendCodePoint(((b0 and 0x0F) shl 12) or ((b1 and 0x3F) shl 6) or (b2 and 0x3F))
                    i += 3
                }
                b0 in 0xF0..0xF4 -> {
                    if (i + 4 > pending.size) return false
                    val b1 = pending[i + 1]
                    val b2 = pending[i + 2]
                    val b3 = pending[i + 3]
                    val b1Min = if (b0 == 0xF0) 0x90 else 0x80
                    val b1Max = if (b0 == 0xF4) 0x8F else 0xBF
                    if (b1 < b1Min || b1 > b1Max || b2 !in 0x80..0xBF || b3 !in 0x80..0xBF) return false
                    sb.appendCodePoint(((b0 and 0x07) shl 18) or ((b1 and 0x3F) shl 12) or ((b2 and 0x3F) shl 6) or (b3 and 0x3F))
                    i += 4
                }
                else -> return false
            }
        }
        pending.clear()
        return true
    }

    // 只认 ASCII 十六进制位，规避各平台宽容差异。
    private fun hexDigit(c: Char): Int? = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> null
    }
}
