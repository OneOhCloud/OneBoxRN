package cloud.oneoh.oneboxn.core

// 路由规则 token 的纯逻辑：三元组模型 + normalize + 三 kind 校验 + 批量拆分。
// 与 iOS Core/RuleToken.swift 逐字对应，golden/rule-token.json 是行为裁判。
// 校验唯一实现于此；纯函数：无 IO、无时钟、无平台依赖。

/** 规则动作。声明序即匹配优先级：引擎 first-match，reject > direct > proxy。 */
enum class RuleAction { REJECT, DIRECT, PROXY }

/** 匹配类别。声明序即展示序。 */
enum class RuleKind { DOMAIN, DOMAIN_SUFFIX, IP_CIDR }

/** 规则 = 三元组，值相等即同一条规则，无独立 id。 */
data class Rule(val action: RuleAction, val kind: RuleKind, val value: String)

object RuleToken {
    /** trim + 小写；后续校验与存储均基于该结果。 */
    fun normalize(raw: String): String {
        var start = 0
        var end = raw.length
        while (start < end && isWhitespace(raw[start])) start++
        while (end > start && isWhitespace(raw[end - 1])) end--
        return raw.substring(start, end).lowercase()
    }

    /** value 是否为给定 kind 的合法 matcher（基于 normalize 后的值）。 */
    fun validate(kind: RuleKind, value: String): Boolean = when (kind) {
        RuleKind.DOMAIN -> isDomain(value)
        RuleKind.DOMAIN_SUFFIX -> isDomain(value.removePrefix("."))
        RuleKind.IP_CIDR -> isIpCidr(value)
    }

    /** 仅换行与逗号为分隔符（连续折叠）→ normalize → 去空串 → 保序去重（首现为准）。 */
    fun parseBulk(text: String): List<String> {
        val seen = HashSet<String>()
        val out = ArrayList<String>()
        for (piece in text.split('\n', ',')) {
            val token = normalize(piece)
            if (token.isEmpty() || !seen.add(token)) continue
            out.add(token)
        }
        return out
    }

    // 空白集写死为四个 ASCII 空白：两端标准库 trim 对 NBSP 等归类不一，固定集合以保两端一致。
    private fun isWhitespace(c: Char): Boolean = c == ' ' || c == '\t' || c == '\n' || c == '\r'

    // 按 '.' 分段后每段非空且仅含 [a-z0-9-]（允许前/后导连字符）；空串拆出单个空段，自然落败。
    private fun isDomain(value: String): Boolean =
        value.split('.').all { segment -> segment.isNotEmpty() && segment.all { isDomainChar(it) } }

    private fun isDomainChar(c: Char): Boolean = c in 'a'..'z' || isDecimalDigit(c) || c == '-'

    // 无斜杠须为纯 v4/v6 地址；有斜杠须为「地址 + 纯数字前缀」，v4 0–32、v6 0–128。
    private fun isIpCidr(value: String): Boolean {
        val slash = value.indexOf('/')
        if (slash < 0) return isIpv4(value) || isIpv6(value)
        val address = value.substring(0, slash)
        val prefix = value.substring(slash + 1)
        if (prefix.isEmpty() || !prefix.all { isDecimalDigit(it) }) return false
        val bits = prefix.toIntOrNull() ?: return false
        return when {
            isIpv4(address) -> bits <= 32
            isIpv6(address) -> bits <= 128
            else -> false
        }
    }

    // 恰 4 段，每段 1–3 位十进制数字且 ≤255（允许前导零）。
    private fun isIpv4(address: String): Boolean {
        val segments = address.split('.')
        if (segments.size != 4) return false
        return segments.all { segment ->
            segment.length in 1..3 && segment.all { isDecimalDigit(it) } && segment.toInt() <= 255
        }
    }

    // 含冒号；"::" 折叠至多一次；无折叠须恰 8 组，有折叠时显式组合计 ≤7（"::" 至少折叠一个全零组）。
    private fun isIpv6(address: String): Boolean {
        if (':' !in address) return false
        val halves = address.split("::")
        if (halves.size > 2) return false
        if (halves.size == 2) {
            val left = if (halves[0].isEmpty()) emptyList() else halves[0].split(':')
            val right = if (halves[1].isEmpty()) emptyList() else halves[1].split(':')
            if (!left.all { isHextet(it) } || !right.all { isHextet(it) }) return false
            return left.size + right.size <= 7
        }
        val groups = address.split(':')
        return groups.size == 8 && groups.all { isHextet(it) }
    }

    private fun isHextet(group: String): Boolean =
        group.length in 1..4 && group.all { isHexDigit(it) }

    // hextet 只认小写十六进制：校验基于 normalize 结果，与 domain 段的小写字面一致。
    private fun isHexDigit(c: Char): Boolean = isDecimalDigit(c) || c in 'a'..'f'

    private fun isDecimalDigit(c: Char): Boolean = c in '0'..'9'
}
