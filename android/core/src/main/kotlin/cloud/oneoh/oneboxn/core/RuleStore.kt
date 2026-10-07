package cloud.oneoh.oneboxn.core

// 自定义分流规则的纯逻辑存储：规范序维护 + 幂等增删改 + 序列化，经 RuleStorage 端口持久化。
// 序列化循 ProfileStore 的 ProfileCodec 模式：v1 版本头 + tab/换行分隔 + 同一转义表。
// 与 iOS Core/RuleStore.swift 逐字对应；golden/rule-store.json 是行为裁判。

class RuleStore(private val storage: RuleStorage) {
    private val rules = mutableListOf<Rule>()

    init {
        val bytes = storage.load()
        if (bytes != null) rules.addAll(RuleCodec.decode(bytes.decodeToString()))
    }

    /** 规范序：action 声明序 → kind 声明序 → value Unicode 标量字典序；展示与注入共用此序列。 */
    fun getAll(): List<Rule> = rules.toList()

    /** 批量加入；与既有三元组重复的幂等跳过（不产生重复）。 */
    fun add(rules: List<Rule>) {
        require(rules.isNotEmpty()) { "add requires at least one rule" }
        for (rule in rules) {
            if (rule !in this.rules) this.rules.add(rule)
        }
        canonicalize()
        persist()
    }

    /** 以 new 替换 old（可跨 action/kind 迁移）；new 与既有条目重复时仅删 old，不产生第二条。 */
    fun replace(old: Rule, new: Rule) {
        require(old in rules) { "unknown rule: $old" }
        rules.remove(old)
        if (new !in rules) rules.add(new)
        canonicalize()
        persist()
    }

    fun remove(rule: Rule) {
        require(rule in rules) { "unknown rule: $rule" }
        rules.remove(rule)
        persist()
    }

    private fun persist() {
        storage.save(RuleCodec.encode(rules.toList()).encodeToByteArray())
    }

    private fun canonicalize() {
        rules.sortWith(Comparator(::canonicalCompare))
    }

    private fun canonicalCompare(a: Rule, b: Rule): Int {
        if (a.action != b.action) return a.action.ordinal - b.action.ordinal
        if (a.kind != b.kind) return a.kind.ordinal - b.kind.ordinal
        return compareScalars(a.value, b.value)
    }

    // value 按 Unicode 标量字典序：显式逐标量比较，规避两端标准库串序语义差异（UTF-16 序 / 本地化序）。
    private fun compareScalars(a: String, b: String): Int {
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            val ca = a.codePointAt(i)
            val cb = b.codePointAt(j)
            if (ca != cb) return ca - cb
            i += Character.charCount(ca)
            j += Character.charCount(cb)
        }
        return (a.length - i) - (b.length - j)
    }

    companion object {
        /** 存储文件名。 */
        const val FILE_NAME = "rules.store"
    }
}

internal object RuleCodec {
    private const val VERSION = "v1"

    fun encode(rules: List<Rule>): String {
        val sb = StringBuilder()
        sb.append(VERSION)
        for (r in rules) {
            sb.append('\n')
            sb.append(actionToken(r.action)).append('\t')
                .append(kindToken(r.kind)).append('\t')
                .append(esc(r.value))
        }
        return sb.toString()
    }

    fun decode(text: String): List<Rule> {
        if (text.isEmpty()) return emptyList()
        val lines = text.split('\n')
        require(lines[0] == VERSION) { "unsupported rule store version: ${lines[0]}" }
        val rules = ArrayList<Rule>()
        for (i in 1 until lines.size) {
            val line = lines[i]
            if (line.isEmpty()) continue
            val f = line.split('\t')
            require(f.size == 3) { "malformed rule record: expected 3 fields, got ${f.size}" }
            rules.add(Rule(action = actionFrom(f[0]), kind = kindFrom(f[1]), value = unesc(f[2])))
        }
        return rules
    }

    private fun actionToken(action: RuleAction): String = when (action) {
        RuleAction.REJECT -> "reject"
        RuleAction.DIRECT -> "direct"
        RuleAction.PROXY -> "proxy"
    }

    // 未知 token 即枚举穷尽破坏：本仓是唯一写入者，坏数据必是本仓 bug。
    private fun actionFrom(token: String): RuleAction = when (token) {
        "reject" -> RuleAction.REJECT
        "direct" -> RuleAction.DIRECT
        "proxy" -> RuleAction.PROXY
        else -> error("unknown rule action token: $token")
    }

    private fun kindToken(kind: RuleKind): String = when (kind) {
        RuleKind.DOMAIN -> "domain"
        RuleKind.DOMAIN_SUFFIX -> "domain_suffix"
        RuleKind.IP_CIDR -> "ip_cidr"
    }

    private fun kindFrom(token: String): RuleKind = when (token) {
        "domain" -> RuleKind.DOMAIN
        "domain_suffix" -> RuleKind.DOMAIN_SUFFIX
        "ip_cidr" -> RuleKind.IP_CIDR
        else -> error("unknown rule kind token: $token")
    }

    private fun esc(s: String): String {
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

    private fun unesc(s: String): String {
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
