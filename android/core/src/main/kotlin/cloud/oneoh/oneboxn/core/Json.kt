package cloud.oneoh.oneboxn.core

// 严格 JSON（RFC 8259）的最小实现（零第三方依赖）：保对象键序、数字保原始字面（lexeme）、确定性紧凑编码。
// 这是配置合并两端逐字节对等的地基；与 iOS Core/Json.swift 逐字对应，golden/json.json 是行为裁判。
// JsonError 只用于外部输入的解析失败；内部不变量违背走 fail-fast 崩溃暴露。

sealed interface JsonValue {
    data class JsonString(val value: String) : JsonValue

    /** 数字保原始字面，序列化原样回写（不数值化，规避两端浮点差异）。 */
    data class JsonNumber(val lexeme: String) : JsonValue

    data class JsonBool(val value: Boolean) : JsonValue

    data object JsonNull : JsonValue

    class JsonArray(val items: MutableList<JsonValue>) : JsonValue

    /** 保插入序的对象：键序即存储序，编码按此序输出。 */
    class JsonObject : JsonValue {
        private val orderedKeys = mutableListOf<String>()
        private val values = mutableMapOf<String, JsonValue>()

        val keys: List<String> get() = orderedKeys.toList()

        /** 键缺失是一等领域状态（本类型中唯一允许返回 null 处）。 */
        fun get(key: String): JsonValue? = values[key]

        /** 已存在键保位置覆盖值；新键追加尾部。 */
        fun set(key: String, value: JsonValue) {
            if (key !in values) orderedKeys.add(key)
            values[key] = value
        }

        /** 不存在则空操作。 */
        fun remove(key: String) {
            if (values.remove(key) != null) orderedKeys.remove(key)
        }
    }
}

class JsonError(message: String) : Exception(message)

object Json {
    /** 严格解析（RFC 8259）：顶层值前后只允许空白；任何偏离抛 JsonError。 */
    fun parse(text: String): JsonValue {
        val parser = Parser(text)
        parser.skipWhitespace()
        val value = parser.parseValue()
        parser.skipWhitespace()
        if (!parser.atEnd()) throw JsonError("unexpected trailing content at index ${parser.index}")
        return value
    }

    /** 确定性紧凑编码：无空白、对象按存储键序、数字回写 lexeme 原文。 */
    fun encode(value: JsonValue): String {
        val sb = StringBuilder()
        encodeValue(value, sb)
        return sb.toString()
    }

    /** 确定性格式化投影：2 空格缩进、键后 ": "、逐项换行；空对象/数组保持 {} / []；其余规则与 encode 同源。 */
    fun encodePretty(value: JsonValue): String {
        val sb = StringBuilder()
        encodePrettyValue(value, sb, 0)
        return sb.toString()
    }

    private fun encodePrettyValue(value: JsonValue, sb: StringBuilder, depth: Int) {
        when (value) {
            is JsonValue.JsonArray -> {
                if (value.items.isEmpty()) {
                    sb.append("[]")
                    return
                }
                // 纯标量数组内联成一行：本仓最大的消费方是配置查看页，其排除网段/规则集是数千条
                // 标量，一行一条会把文档撑到近七千行——呈现端的内存与滚动代价直接与行数挂钩，
                // 而这些条目逐行阅读本就无意义。含对象/数组的项仍逐行展开，结构可读性不变。
                if (value.items.none { it is JsonValue.JsonArray || it is JsonValue.JsonObject }) {
                    sb.append('[')
                    value.items.forEachIndexed { i, item ->
                        if (i > 0) sb.append(", ")
                        encodeValue(item, sb)
                    }
                    sb.append(']')
                    return
                }
                sb.append("[\n")
                value.items.forEachIndexed { i, item ->
                    if (i > 0) sb.append(",\n")
                    appendIndent(sb, depth + 1)
                    encodePrettyValue(item, sb, depth + 1)
                }
                sb.append('\n')
                appendIndent(sb, depth)
                sb.append(']')
            }
            is JsonValue.JsonObject -> {
                if (value.keys.isEmpty()) {
                    sb.append("{}")
                    return
                }
                sb.append("{\n")
                value.keys.forEachIndexed { i, key ->
                    if (i > 0) sb.append(",\n")
                    appendIndent(sb, depth + 1)
                    encodeString(key, sb)
                    sb.append(": ")
                    encodePrettyValue(value.get(key)!!, sb, depth + 1)
                }
                sb.append('\n')
                appendIndent(sb, depth)
                sb.append('}')
            }
            else -> encodeValue(value, sb)
        }
    }

    private fun appendIndent(sb: StringBuilder, depth: Int) {
        repeat(depth) { sb.append("  ") }
    }

    private fun encodeValue(value: JsonValue, sb: StringBuilder) {
        when (value) {
            is JsonValue.JsonString -> encodeString(value.value, sb)
            is JsonValue.JsonNumber -> sb.append(value.lexeme)
            is JsonValue.JsonBool -> sb.append(if (value.value) "true" else "false")
            JsonValue.JsonNull -> sb.append("null")
            is JsonValue.JsonArray -> {
                sb.append('[')
                value.items.forEachIndexed { i, item ->
                    if (i > 0) sb.append(',')
                    encodeValue(item, sb)
                }
                sb.append(']')
            }
            is JsonValue.JsonObject -> {
                sb.append('{')
                value.keys.forEachIndexed { i, key ->
                    if (i > 0) sb.append(',')
                    encodeString(key, sb)
                    sb.append(':')
                    encodeValue(value.get(key)!!, sb)
                }
                sb.append('}')
            }
        }
    }

    // 转义规则：双引号/反斜杠/五个短转义；其余 <0x20 用小写 \u00xx；'/' 不转义；非 ASCII 原样输出。
    private fun encodeString(s: String, sb: StringBuilder) {
        sb.append('"')
        for (c in s) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c == '\u0008' -> sb.append("\\b")
                c == '\u000C' -> sb.append("\\f")
                c.code < 0x20 -> sb.append("\\u").append(c.code.toString(16).padStart(4, '0'))
                else -> sb.append(c)
            }
        }
        sb.append('"')
    }
}

private class Parser(private val text: String) {
    var index = 0

    fun atEnd(): Boolean = index >= text.length

    fun skipWhitespace() {
        while (!atEnd() && (text[index] == ' ' || text[index] == '\t' || text[index] == '\n' || text[index] == '\r')) {
            index++
        }
    }

    fun parseValue(): JsonValue {
        if (atEnd()) throw JsonError("unexpected end of input")
        return when (val c = text[index]) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> JsonValue.JsonString(parseString())
            't' -> parseLiteral("true", JsonValue.JsonBool(true))
            'f' -> parseLiteral("false", JsonValue.JsonBool(false))
            'n' -> parseLiteral("null", JsonValue.JsonNull)
            else ->
                if (c == '-' || c in '0'..'9') parseNumber()
                else throw JsonError("unexpected character '$c' at index $index")
        }
    }

    private fun parseObject(): JsonValue.JsonObject {
        index++ // 消费 '{'
        val objectValue = JsonValue.JsonObject()
        skipWhitespace()
        if (!atEnd() && text[index] == '}') {
            index++
            return objectValue
        }
        while (true) {
            skipWhitespace()
            if (atEnd() || text[index] != '"') throw JsonError("expected string key at index $index")
            val key = parseString()
            skipWhitespace()
            expect(':')
            skipWhitespace()
            objectValue.set(key, parseValue()) // 重复键：后值胜、位置取首现（set 语义天然给出）
            skipWhitespace()
            when {
                atEnd() -> throw JsonError("unterminated object at index $index")
                text[index] == ',' -> index++
                text[index] == '}' -> {
                    index++
                    return objectValue
                }
                else -> throw JsonError("expected ',' or '}' at index $index")
            }
        }
    }

    private fun parseArray(): JsonValue.JsonArray {
        index++ // 消费 '['
        val items = mutableListOf<JsonValue>()
        skipWhitespace()
        if (!atEnd() && text[index] == ']') {
            index++
            return JsonValue.JsonArray(items)
        }
        while (true) {
            skipWhitespace()
            items.add(parseValue())
            skipWhitespace()
            when {
                atEnd() -> throw JsonError("unterminated array at index $index")
                text[index] == ',' -> index++
                text[index] == ']' -> {
                    index++
                    return JsonValue.JsonArray(items)
                }
                else -> throw JsonError("expected ',' or ']' at index $index")
            }
        }
    }

    private fun parseLiteral(literal: String, value: JsonValue): JsonValue {
        if (!text.startsWith(literal, index)) throw JsonError("invalid literal at index $index")
        index += literal.length
        return value
    }

    // 数字文法 -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?；通过即存 lexeme 原文。
    private fun parseNumber(): JsonValue.JsonNumber {
        val start = index
        if (text[index] == '-') index++
        if (atEnd()) throw JsonError("truncated number at index $index")
        when {
            text[index] == '0' -> index++
            text[index] in '1'..'9' -> while (!atEnd() && text[index] in '0'..'9') index++
            else -> throw JsonError("invalid number at index $index")
        }
        if (!atEnd() && text[index] == '.') {
            index++
            consumeDigits("fraction")
        }
        if (!atEnd() && (text[index] == 'e' || text[index] == 'E')) {
            index++
            if (!atEnd() && (text[index] == '+' || text[index] == '-')) index++
            consumeDigits("exponent")
        }
        return JsonValue.JsonNumber(text.substring(start, index))
    }

    private fun consumeDigits(part: String) {
        if (atEnd() || text[index] !in '0'..'9') throw JsonError("digit expected in $part at index $index")
        while (!atEnd() && text[index] in '0'..'9') index++
    }

    private fun parseString(): String {
        index++ // 消费开引号
        val sb = StringBuilder()
        while (true) {
            if (atEnd()) throw JsonError("unterminated string at index $index")
            val c = text[index]
            when {
                c == '"' -> {
                    index++
                    return sb.toString()
                }
                c == '\\' -> {
                    index++
                    parseEscape(sb)
                }
                c.code < 0x20 -> throw JsonError("raw control character in string at index $index")
                else -> {
                    sb.append(c)
                    index++
                }
            }
        }
    }

    private fun parseEscape(sb: StringBuilder) {
        if (atEnd()) throw JsonError("truncated escape at index $index")
        val c = text[index]
        index++
        when (c) {
            '"' -> sb.append('"')
            '\\' -> sb.append('\\')
            '/' -> sb.append('/')
            'b' -> sb.append('\u0008')
            'f' -> sb.append('\u000C')
            'n' -> sb.append('\n')
            'r' -> sb.append('\r')
            't' -> sb.append('\t')
            'u' -> parseUnicodeEscape(sb)
            else -> throw JsonError("unknown escape '\\$c' at index ${index - 1}")
        }
    }

    // \uXXXX：高代理项必须紧跟 \u 低代理项合成增补字符；孤立代理项两端无法一致编码为 UTF-8，拒绝。
    private fun parseUnicodeEscape(sb: StringBuilder) {
        val code = parseHex4()
        when (code) {
            in 0xD800..0xDBFF -> {
                if (!text.startsWith("\\u", index)) throw JsonError("lone high surrogate at index $index")
                index += 2
                val low = parseHex4()
                if (low !in 0xDC00..0xDFFF) throw JsonError("invalid low surrogate at index $index")
                sb.append(code.toChar()).append(low.toChar())
            }
            in 0xDC00..0xDFFF -> throw JsonError("lone low surrogate at index $index")
            else -> sb.append(code.toChar())
        }
    }

    private fun parseHex4(): Int {
        if (index + 4 > text.length) throw JsonError("truncated unicode escape at index $index")
        var code = 0
        repeat(4) {
            val digit = hexDigit(text[index]) ?: throw JsonError("invalid hex digit at index $index")
            code = code * 16 + digit
            index++
        }
        return code
    }

    // 只认 ASCII 十六进制位，规避各平台「全角/其他数字」宽容差异。
    private fun hexDigit(c: Char): Int? = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> null
    }

    private fun expect(c: Char) {
        if (atEnd() || text[index] != c) throw JsonError("expected '$c' at index $index")
        index++
    }
}
