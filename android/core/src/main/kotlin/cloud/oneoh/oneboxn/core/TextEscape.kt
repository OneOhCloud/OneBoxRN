package cloud.oneoh.oneboxn.core

// 行式存储的字段转义：把 `\ \n \r \t` 挪出字段值，好让换行分记录、制表符分字段。
// ProfileStore 与 RefreshRecordStore 共用同一份。
// 与 iOS Core/TextEscape.swift 逐字对应；ProfileStore 的字节特征测试是它的行为裁判。
internal object TextEscape {
    fun escape(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    /** 未知转义序列保留其被转义字符（宽容解码：存储只由本对象产出，不会有未知序列）。 */
    fun unescape(s: String): String {
        val sb = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length) {
                when (s[i + 1]) {
                    '\\' -> sb.append('\\')
                    'n' -> sb.append('\n')
                    'r' -> sb.append('\r')
                    't' -> sb.append('\t')
                    else -> sb.append(s[i + 1])
                }
                i += 2
            } else {
                sb.append(c)
                i++
            }
        }
        return sb.toString()
    }
}
