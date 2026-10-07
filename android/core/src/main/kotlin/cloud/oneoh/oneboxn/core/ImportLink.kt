package cloud.oneoh.oneboxn.core

// 三源载荷解析：OS 深链 / 二维码文本 / 手输文本共用的唯一解析器。
// 纯函数：无 IO、无时钟、无平台依赖；与 iOS Core/ImportLink.swift 逐字对应，golden/import-link.json 是行为裁判。
// 四种拒因均为类型化领域错误（一切输入皆外部，本模块无崩溃类）。

data class ImportPayload(val url: String, val requestedApply: Boolean)

enum class LinkReject { NOT_LINK, MISSING_DATA, BAD_BASE64, NOT_HTTPS }

sealed interface LinkVerdict {
    data class Accepted(val payload: ImportPayload) : LinkVerdict

    data class Rejected(val reason: LinkReject) : LinkVerdict
}

object ImportLink {
    // scheme 字面量全仓唯一出处 = 本文件（此外仅两端 OS 注册清单，OS 语法所需）。
    private const val SCHEME_PREFIX = "oneoh-networktools://config"
    private const val HTTPS_PREFIX = "https://"

    /**
     * 三分支识别（大小写敏感）：先去首尾 ASCII 空白，再判前缀——scheme 链接解析查询串；
     * 裸 https 直接接受；其余拒绝 NOT_LINK。
     *
     * 去空白在**解析器内部**：粘贴来的链接常带尾随换行，若交由各入口自行 trim，就会出现一端去、
     * 另一端不去（UI 层不自带判断）。空白集显式限定为四个 ASCII 字符，与 ConfigCheck 的空判定
     * 同一集合——两端原生 trim 的 Unicode 空白集不一致（如 U+00A0）。
     */
    fun parse(rawInput: String): LinkVerdict {
        val raw = trimAsciiWhitespace(rawInput)
        if (raw.startsWith(SCHEME_PREFIX)) return parseSchemeLink(raw)
        if (raw.startsWith(HTTPS_PREFIX)) {
            return LinkVerdict.Accepted(ImportPayload(url = raw, requestedApply = false))
        }
        return LinkVerdict.Rejected(LinkReject.NOT_LINK)
    }

    private fun trimAsciiWhitespace(text: String): String {
        fun isSpace(c: Char) = c == ' ' || c == '\t' || c == '\n' || c == '\r'
        var start = 0
        var end = text.length
        while (start < end && isSpace(text[start])) start++
        while (end > start && isSpace(text[end - 1])) end--
        return text.substring(start, end)
    }

    // 查询串取 data 与 apply，data 经 forgiving-base64 + 严格 UTF-8 还原为 url；
    // apply 恰为 "1" 才 true，缺失或其它值一律 false（不报错、不告警）。
    private fun parseSchemeLink(raw: String): LinkVerdict {
        val pairs = parseQuery(raw)
        val data = firstValue(pairs, "data")
        if (data.isNullOrEmpty()) return LinkVerdict.Rejected(LinkReject.MISSING_DATA)
        val bytes = decodeForgivingBase64(data) ?: return LinkVerdict.Rejected(LinkReject.BAD_BASE64)
        val url = try {
            bytes.decodeToString(throwOnInvalidSequence = true)
        } catch (_: CharacterCodingException) {
            // 外部输入的解码失败在边界立即转类型化领域错误。
            return LinkVerdict.Rejected(LinkReject.BAD_BASE64)
        }
        if (!url.startsWith(HTTPS_PREFIX)) return LinkVerdict.Rejected(LinkReject.NOT_HTTPS)
        return LinkVerdict.Accepted(ImportPayload(url = url, requestedApply = firstValue(pairs, "apply") == "1"))
    }

    // 首个 '?' 之后为查询串（无 '?' 即无参数）：按 & 拆对、首个 = 拆键值、两侧各自 percent 解码。
    // 有意差异：'+' 不视为空格——RN 经 URLSearchParams 会做该转换并破坏含未编码 '+' 的载荷，
    // 实际流通载荷均经 percent 编码，本仓不复制该缺陷。
    private fun parseQuery(raw: String): List<Pair<String, String>> {
        val questionIndex = raw.indexOf('?')
        if (questionIndex < 0) return emptyList()
        return raw.substring(questionIndex + 1).split('&').map { pair ->
            val equalsIndex = pair.indexOf('=')
            if (equalsIndex < 0) {
                percentDecode(pair) to ""
            } else {
                percentDecode(pair.substring(0, equalsIndex)) to percentDecode(pair.substring(equalsIndex + 1))
            }
        }
    }

    /** 同键多现取首个；键缺失是一等领域状态（本文件仅此处与 base64 失败信号允许 null）。 */
    private fun firstValue(pairs: List<Pair<String, String>>, key: String): String? =
        pairs.firstOrNull { it.first == key }?.second

    // 严格 %XX（两位 ASCII 十六进制）逐字节还原后整体按严格 UTF-8 解码；
    // 任何非法序列（% 后不足两位十六进制、或还原字节非合法 UTF-8）→ 该值整体保留原样不解码。
    private fun percentDecode(component: String): String {
        val bytes = ArrayList<Byte>(component.length)
        var i = 0
        while (i < component.length) {
            if (component[i] == '%') {
                if (i + 3 > component.length) return component
                val hi = hexDigit(component[i + 1]) ?: return component
                val lo = hexDigit(component[i + 2]) ?: return component
                bytes.add((hi * 16 + lo).toByte())
                i += 3
            } else {
                val start = i
                while (i < component.length && component[i] != '%') i++
                for (b in component.substring(start, i).encodeToByteArray()) bytes.add(b)
            }
        }
        return try {
            bytes.toByteArray().decodeToString(throwOnInvalidSequence = true)
        } catch (_: CharacterCodingException) {
            component
        }
    }

    // WHATWG forgiving-base64（对齐 atob）：先移除全部 ASCII 空白；仅标准字母表 A-Za-z0-9+/ 与
    // 尾部至多 2 个 =（URL-safe 的 -_ 或其它字符即失败）；剥 = 后剩余长度 %4==1 失败；
    // 末组按位解码：容忍缺 padding、非规范尾位不强校验。手写实现：平台 Base64 类两端容忍度不一，无法逐字对应。
    private fun decodeForgivingBase64(text: String): ByteArray? {
        val kept = StringBuilder(text.length)
        for (c in text) {
            if (c != ' ' && c != '\t' && c != '\n' && c != '\u000C' && c != '\r') kept.append(c)
        }
        var length = kept.length
        var padding = 0
        while (padding < 2 && length > 0 && kept[length - 1] == '=') {
            length--
            padding++
        }
        if (length % 4 == 1) return null
        val bytes = ArrayList<Byte>(length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (i in 0 until length) {
            val value = alphabetValue(kept[i]) ?: return null
            buffer = ((buffer shl 6) or value) and 0xFFFF
            bits += 6
            if (bits >= 8) {
                bits -= 8
                bytes.add(((buffer shr bits) and 0xFF).toByte())
            }
        }
        return bytes.toByteArray()
    }

    private fun alphabetValue(c: Char): Int? = when (c) {
        in 'A'..'Z' -> c - 'A'
        in 'a'..'z' -> c - 'a' + 26
        in '0'..'9' -> c - '0' + 52
        '+' -> 62
        '/' -> 63
        else -> null
    }

    // 只认 ASCII 十六进制位，规避各平台「全角/其他数字」宽容差异（同 Json 解析器纪律）。
    private fun hexDigit(c: Char): Int? = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> null
    }
}
