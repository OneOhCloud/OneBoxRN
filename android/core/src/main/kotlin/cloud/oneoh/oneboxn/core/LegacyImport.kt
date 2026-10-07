package cloud.oneoh.oneboxn.core

// 上一代应用（同包名、同签名，覆盖安装升级而来）留在本机 kv_store 里的数据：首次启动时一次性换算进本应用。
// 读库与「只做一次」的记账在平台层；本文件只做纯换算（plan）与落库（apply），两端逐字对应
// iOS Core/LegacyImport.swift，golden/legacy-import.json 是行为裁判。
//
// 上一代的持久化键是对外不可改的历史事实，故在此逐字列出：
//   sub_ids（id 数组 JSON）/ sub_<id>（profile JSON）/ active_sub_id —— 多配置格式；
//   configLink / configName / usedTraffic / totalTraffic / expireTime / configContent —— 更早的单配置格式，
//     sub_migration_v1 == "1" 表示上一代已把它并入多配置格式；
//   mode —— 路由模式 token；custom_ruleset_<action> —— 自定义规则（domain / domain_suffix / ip_cidr 三组数组）。

/** 换算出的一条配置：上一代只有这些字段，id 与刷新时刻由落库时补。 */
data class LegacyProfile(
    val name: String,
    val url: String,
    val usedTraffic: Long,
    val totalTraffic: Long,
    val expireTime: Long,
    /** 上一代首次导入的时刻（毫秒）；0 = 上一代没记下。 */
    val addedAt: Long,
    val content: String,
)

data class LegacyImportPlan(
    val profiles: List<LegacyProfile>,
    /** 激活项在 [profiles] 中的下标；没有配置时为 null。 */
    val activeIndex: Int?,
    val routingMode: RoutingMode?,
    val rules: List<Rule>,
) {
    val isEmpty: Boolean get() = profiles.isEmpty() && routingMode == null && rules.isEmpty()
}

object LegacyImport {
    private const val PROFILE_IDS_KEY = "sub_ids"
    private const val ACTIVE_PROFILE_KEY = "active_sub_id"
    private const val SINGLE_PROFILE_MIGRATED_KEY = "sub_migration_v1"
    private const val MODE_KEY = "mode"

    // 上一代规则的动作与类别 token，声明序即展开序（与本应用的展示序一致）。
    private val ACTION_TOKENS = listOf(
        RuleAction.REJECT to "reject",
        RuleAction.DIRECT to "direct",
        RuleAction.PROXY to "proxy",
    )
    private val KIND_TOKENS = listOf(
        RuleKind.DOMAIN to "domain",
        RuleKind.DOMAIN_SUFFIX to "domain_suffix",
        RuleKind.IP_CIDR to "ip_cidr",
    )

    fun plan(entries: Map<String, String>): LegacyImportPlan {
        val profiles = mutableListOf<LegacyProfile>()
        val ids = mutableListOf<String>()
        val seenUrls = HashSet<String>()
        for (id in profileIds(entries)) {
            val profile = multiProfile(entries["sub_$id"]) ?: continue
            if (!seenUrls.add(profile.url)) continue
            profiles.add(profile)
            ids.add(id)
        }
        var activeIndex = ids.indexOf(entries[ACTIVE_PROFILE_KEY]).takeIf { it >= 0 }
            ?: if (profiles.isEmpty()) null else 0
        val single = singleProfile(entries)
        if (single != null && seenUrls.add(single.url)) {
            profiles.add(single)
            activeIndex = profiles.lastIndex
        }
        return LegacyImportPlan(
            profiles = profiles,
            activeIndex = activeIndex,
            routingMode = RoutingMode.entries.firstOrNull { it.token == entries[MODE_KEY] },
            rules = rules(entries),
        )
    }

    /**
     * 落库：按计划顺序 upsert（同 url 并入既有项），再把激活指针指到计划的激活项。
     * 上一代没有「最近刷新」时刻：取它的首次导入时刻，没有就取本次导入时刻。
     */
    fun apply(plan: LegacyImportPlan, profiles: ProfileStore, rules: RuleStore, newId: () -> String, nowMillis: Long) {
        val stored = plan.profiles.map { legacy ->
            val stamp = if (legacy.addedAt > 0) legacy.addedAt else nowMillis
            profiles.upsertByUrl(
                Profile(
                    id = newId(),
                    name = legacy.name,
                    url = legacy.url,
                    usedTraffic = legacy.usedTraffic,
                    totalTraffic = legacy.totalTraffic,
                    expireTime = legacy.expireTime,
                    addedAt = stamp,
                    updatedAt = stamp,
                    website = null,
                ),
                legacy.content,
            )
        }
        plan.activeIndex?.let { profiles.setActive(stored[it].id) }
        if (plan.rules.isNotEmpty()) rules.add(plan.rules)
    }

    private fun profileIds(entries: Map<String, String>): List<String> {
        val array = parseOrNull(entries[PROFILE_IDS_KEY]) as? JsonValue.JsonArray ?: return emptyList()
        return array.items.mapNotNull { (it as? JsonValue.JsonString)?.value }
    }

    private fun multiProfile(raw: String?): LegacyProfile? {
        val obj = parseOrNull(raw) as? JsonValue.JsonObject ?: return null
        val url = string(obj, "url")
        if (url.isEmpty()) return null
        return LegacyProfile(
            name = string(obj, "name").ifEmpty { ProfileName.derive("", "", url) },
            url = url,
            usedTraffic = number(obj.get("usedTraffic")),
            totalTraffic = number(obj.get("totalTraffic")),
            expireTime = number(obj.get("expireTime")),
            addedAt = number(obj.get("addedAt")),
            content = string(obj, "configContent"),
        )
    }

    private fun singleProfile(entries: Map<String, String>): LegacyProfile? {
        if (entries[SINGLE_PROFILE_MIGRATED_KEY] == "1") return null
        val url = entries["configLink"].orEmpty()
        if (url.isEmpty()) return null
        // 上一代以 "default" 作「未命名」的占位名。
        val existing = entries["configName"].orEmpty().takeUnless { it == "default" }.orEmpty()
        return LegacyProfile(
            name = ProfileName.derive("", existing, url),
            url = url,
            usedTraffic = number(entries["usedTraffic"]),
            totalTraffic = number(entries["totalTraffic"]),
            expireTime = number(entries["expireTime"]),
            addedAt = 0,
            content = entries["configContent"].orEmpty(),
        )
    }

    private fun rules(entries: Map<String, String>): List<Rule> {
        val seen = LinkedHashSet<Rule>()
        for ((action, actionToken) in ACTION_TOKENS) {
            val set = parseOrNull(entries["custom_ruleset_$actionToken"]) as? JsonValue.JsonObject ?: continue
            for ((kind, kindToken) in KIND_TOKENS) {
                val values = set.get(kindToken) as? JsonValue.JsonArray ?: continue
                for (item in values.items) {
                    val value = RuleToken.normalize((item as? JsonValue.JsonString)?.value ?: continue)
                    if (RuleToken.validate(kind, value)) seen.add(Rule(action, kind, value))
                }
            }
        }
        return seen.toList()
    }

    // 上一代的值是它自己写下的，但跨版本、跨崩溃的残片可能是坏的：坏一条只丢那一条，不拖累其余。
    private fun parseOrNull(raw: String?): JsonValue? {
        if (raw == null) return null
        return try {
            Json.parse(raw)
        } catch (_: JsonError) {
            null
        }
    }

    private fun string(obj: JsonValue.JsonObject, key: String): String =
        (obj.get(key) as? JsonValue.JsonString)?.value.orEmpty()

    private fun number(value: JsonValue?): Long = number((value as? JsonValue.JsonNumber)?.lexeme)

    // 缺失与不可读一律 0：本应用里 0 即「上游没给」（见 Userinfo）。
    private fun number(raw: String?): Long = raw?.toDoubleOrNull()
        ?.takeIf { it.isFinite() && it >= Long.MIN_VALUE.toDouble() && it < Long.MAX_VALUE.toDouble() }
        ?.toLong() ?: 0
}
