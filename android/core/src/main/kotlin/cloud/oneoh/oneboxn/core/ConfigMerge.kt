package cloud.oneoh.oneboxn.core

// 配置合并：从 [MergeInput] 的**全部**入参到引擎实际
// 接收配置的确定性纯函数——无 IO、无时钟、无平台分支、无内核分支。
// 入参全集以 [MergeInput] 的字段为准，那是它唯一的定义处，这里不另抄一份清单。
// 与 iOS Core/ConfigMerge.swift 逐字对应，golden/config-merge.json 是行为裁判。
// 错误两分：导入内容来自外部 → MergeError 领域错误；模板/锚点是本仓资产 → 崩溃。

/** 两段路由模式：枚举与 token 双射，无第三态。 */
enum class RoutingMode(val token: String) {
    TUN_RULES("tun-rules"),
    TUN_GLOBAL("tun-global");

    companion object {
        /** token↔枚举映射唯一实现：未知 token 即枚举穷尽破坏，崩溃暴露。 */
        fun fromToken(token: String): RoutingMode =
            entries.firstOrNull { it.token == token }
                ?: error("unknown routing mode token: $token")
    }
}

/** 导入内容不可合并的领域错误：查看页可重试态，启动路径映射为启动失败。 */
class MergeError(message: String) : Exception(message)

/**
 * TUN 排除项交给谁执行。
 *
 * 系统路由表里的每一条排除都常驻在系统守护进程里（nesessionmanager / configd），数千条会把
 * 它们推过自身的内存高水位，系统一有内存压力就被清理，VPN 会话随之被系统停掉。于是 iOS 上
 * 只把大网段交给系统（日常流量几乎都落在这些大网段里），更细的交给引擎直连。
 */
sealed interface TunExclusionPolicy {
    /** 导入值全部并入模板的 TUN 排除字段，由平台整体执行。 */
    data object Union : TunExclusionPolicy

    /** 前缀不长于门限的导入排除交给系统；更长的编译成最前置、限定 TUN 入站的直连规则。 */
    data class SystemBudget(val maxIPv4PrefixLength: Int, val maxIPv6PrefixLength: Int) : TunExclusionPolicy
}

/** 合并输入全集：纯函数入参，平台差异只经 tunExcludeField 与 tunExclusionPolicy 注入。 */
data class MergeInput(
    val importedConfig: String,
    val template: String,
    val mode: RoutingMode,
    val rules: List<Rule>,
    val logLevel: String,
    val directDns: String,
    val tunExcludeField: String,
    val tunExclusionPolicy: TunExclusionPolicy,
)

object ConfigMerge {
    /** 平台 TUN 排除字段名：core 内不做平台分支，由调用方注入其一。 */
    const val TUN_EXCLUDE_ANDROID = "exclude_package"
    const val TUN_EXCLUDE_APPLE = "route_exclude_address"

    /** 内置回退公共 DNS：该字面量在代码中唯一出处即此。 */
    private const val FALLBACK_DIRECT_DNS = "119.29.29.29"

    /**
     * 组/功能型 outbound 不是节点，剔除不注入。
     * public 供查看页「+N 出站」展示派生消费同一集合（单一来源）。
     */
    val EXCLUDED_OUTBOUND_TYPES = setOf("selector", "urltest", "direct", "block", "dns")

    /**
     * 导入内容的处理上限：下载期已卡一次，此处是**本地编译边界的兜底**——
     * 已存档的超大配置（旧版本写入、或抓取侧将来出缺陷）不得绕过。放在合并入口而不是各调用点：
     * 启动路径与配置查看页共用同一入口，分散检查必然漏一处。
     */
    const val MAX_IMPORTED_CONFIG_SIZE = 4 * 1024 * 1024

    /** 合并输出上限：注入会让输出大于输入，故不等于上一条。 */
    const val MAX_COMPILED_CONFIG_SIZE = MAX_IMPORTED_CONFIG_SIZE * 2

    fun merge(input: MergeInput): String {
        if (Utf8Length.of(input.importedConfig) > MAX_IMPORTED_CONFIG_SIZE) {
            // 内容来自外部 → 领域错误，不崩溃。
            throw MergeError("imported config exceeds processing limit")
        }
        val imported = parseImported(input.importedConfig)
        val template = parseTemplate(input.template)
        when (input.mode) {
            RoutingMode.TUN_RULES -> injectRules(template, input.rules)
            RoutingMode.TUN_GLOBAL -> Unit
        }
        rewriteDirectDns(template, input.directDns)
        overrideLogLevel(template, input.logLevel)
        stripClashApi(template)
        enableRuleSetCache(template)
        persistFakeIpMapping(template)
        unionTunExclusions(template, imported, input)
        injectNodes(template, imported)
        val compiled = Json.encode(template)
        // 输出上限（兜底）：合法的导入内容也可能在注入后膨胀（超长 tag 会在节点与两个分组里
        // 各出现一次），故出口另有一道。与入口同在合并函数内——它是两端唯一的合并出口。
        if (Utf8Length.of(compiled) > MAX_COMPILED_CONFIG_SIZE) {
            throw MergeError("compiled config exceeds processing limit")
        }
        return compiled
    }

    // 导入内容来自外部：解析失败/顶层非对象在此边界转类型化领域错误。
    private fun parseImported(text: String): JsonValue.JsonObject {
        val parsed = try {
            Json.parse(text)
        } catch (rejected: JsonError) {
            throw MergeError("imported config is not valid JSON: ${rejected.message}")
        }
        return parsed as? JsonValue.JsonObject
            ?: throw MergeError("imported config top-level must be an object")
    }

    // 模板是本仓资产：解析失败/顶层非对象即崩溃。
    private fun parseTemplate(text: String): JsonValue.JsonObject {
        val parsed = try {
            Json.parse(text)
        } catch (broken: JsonError) {
            error("template is not valid JSON: ${broken.message}")
        }
        require(parsed is JsonValue.JsonObject) { "template top-level must be an object" }
        return parsed
    }

    // 规则注入（仅 tun-rules）：按 action 分组保入参序；route.rules 缺失即无锚点可命中，全部静默跳过；
    // 单 action 锚点缺失亦静默跳过（镜像 RN 的行为，golden 锁定，非吞错）；绝不改锚点的 action/outbound。
    private fun injectRules(template: JsonValue.JsonObject, rules: List<Rule>) {
        val routeRules = (template.get("route") as? JsonValue.JsonObject)
            ?.get("rules") as? JsonValue.JsonArray ?: return
        for (action in RuleAction.entries) {
            val group = rules.filter { it.action == action }
            if (group.isEmpty()) continue
            val anchor = findAnchor(routeRules, actionToken(action)) ?: continue
            for (rule in group) {
                targetArray(anchor, matcherField(rule.kind)).items.add(JsonValue.JsonString(rule.value))
            }
        }
    }

    // 锚点判定：首条「domain 数组含以 "<action>-tag." 开头字符串」的 rule。
    // 有意差异：RN 用完整锚点字面量比对，本仓改前缀匹配以免域名字面量入仓；对真实模板二者选中同一条。
    private fun findAnchor(routeRules: JsonValue.JsonArray, token: String): JsonValue.JsonObject? {
        val prefix = "$token-tag."
        for (item in routeRules.items) {
            val rule = item as? JsonValue.JsonObject ?: continue
            val domains = rule.get("domain") as? JsonValue.JsonArray ?: continue
            if (domains.items.any { it is JsonValue.JsonString && it.value.startsWith(prefix) }) return rule
        }
        return null
    }

    // 直连 DNS 改写：首条 tag=="system" 项 set type/server/server_port；dns/servers 缺失或无 system 项 → 空操作。
    private fun rewriteDirectDns(template: JsonValue.JsonObject, directDns: String) {
        val servers = (template.get("dns") as? JsonValue.JsonObject)
            ?.get("servers") as? JsonValue.JsonArray ?: return
        val system = firstSystemServer(servers) ?: return
        val server = resolveDirectDns(directDns, system)
        system.set("type", JsonValue.JsonString("udp"))
        system.set("server", JsonValue.JsonString(server))
        system.set("server_port", JsonValue.JsonNumber("53"))
    }

    private fun firstSystemServer(servers: JsonValue.JsonArray): JsonValue.JsonObject? {
        for (item in servers.items) {
            val server = item as? JsonValue.JsonObject ?: continue
            if ((server.get("tag") as? JsonValue.JsonString)?.value == "system") return server
        }
        return null
    }

    // server 三级取值：参数非空 → 参数；模板原值为非空白字符串 → 原值；否则内置回退。
    private fun resolveDirectDns(directDns: String, system: JsonValue.JsonObject): String {
        if (directDns.isNotEmpty()) return directDns
        val original = (system.get("server") as? JsonValue.JsonString)?.value
        if (original != null && !isBlank(original)) return original
        return FALLBACK_DIRECT_DNS
    }

    // 日志级别覆盖：模板自带值一律被覆盖；log 节缺失则创建。
    private fun overrideLogLevel(template: JsonValue.JsonObject, logLevel: String) {
        val existing = template.get("log")
        if (existing == null) {
            val log = JsonValue.JsonObject()
            log.set("level", JsonValue.JsonString(logLevel))
            template.set("log", log)
            return
        }
        require(existing is JsonValue.JsonObject) { "template log must be an object" }
        existing.set("level", JsonValue.JsonString(logLevel))
    }

    // 剥离 clash_api：experimental 节缺失时空操作，其余字段保留。
    private fun stripClashApi(template: JsonValue.JsonObject) {
        (template.get("experimental") as? JsonValue.JsonObject)?.remove("clash_api")
    }

    // 启用规则集缓存：`experimental.cache_file.enabled` 置真，缺失的中间层就地创建。
    //
    // 取值不听凭模板：模板是抓取来的外部资产，而这个开关缺省关闭时引擎走内存缓存，
    // 于是每一次启动都要把全部远端规则集重下一遍——那一步就压在 engine.start() 的阻塞路径上，
    // 宿主的启动预算量的正是它。上游改一笔模板就能把这条静默关回去，故与剥离 clash_api 同姿势：
    // `experimental` 节由合并管线决定。
    //
    // 不注入 `path`：两端 setup() 都把进程工作目录设成各自的引擎工作目录，而引擎的缺省缓存路径
    // 是相对名，缺省即落在该目录内。注入绝对路径会把平台差异带进纯函数。
    private fun enableRuleSetCache(template: JsonValue.JsonObject) {
        writeKeyPath(template, "experimental.cache_file.enabled", JsonValue.JsonBool(true))
    }

    // 引擎重建实例时内存 FakeIP 库会丢，系统却仍持有旧应答：映射不落盘，旧地址就查无域名或被改判给别的域名。
    private fun persistFakeIpMapping(template: JsonValue.JsonObject) {
        writeKeyPath(template, "experimental.cache_file.store_fakeip", JsonValue.JsonBool(true))
    }

    // TUN 绕行并集：模板值保序在前 + 导入值去重按序追加；任一侧无 TUN inbound 或导入值为空 → 空操作。
    // SystemBudget 下超门限的导入值不进并集，改编译成一条直连规则（见 TunExclusionPolicy）。
    private fun unionTunExclusions(
        template: JsonValue.JsonObject,
        imported: JsonValue.JsonObject,
        input: MergeInput,
    ) {
        val field = input.tunExcludeField
        val importedTun = firstTunInbound(imported) ?: return
        val templateTun = firstTunInbound(template) ?: return
        val userValues = stringItems(importedTun.get(field) as? JsonValue.JsonArray)
        if (userValues.isEmpty()) return
        val target = targetArray(templateTun, field)
        val seen = stringItems(target).toMutableSet()
        val engineCidrs = linkedSetOf<String>()
        for (value in userValues) {
            if (exceedsSystemBudget(value, input.tunExclusionPolicy)) {
                engineCidrs.add(value)
            } else if (seen.add(value)) {
                target.items.add(JsonValue.JsonString(value))
            }
        }
        if (engineCidrs.isNotEmpty()) prependTunDirectRule(template, templateTun, engineCidrs.toList())
    }

    // 只看前缀长度与地址族：地址本身的合法性由引擎在解析期校验（坏值照样 fail-loud）。
    // 不带前缀长度的单个地址按主机路由（/32、/128）计。前缀长度不是整数的值留在并集里，同样交给引擎拒绝。
    private fun exceedsSystemBudget(value: String, policy: TunExclusionPolicy): Boolean {
        val budget = when (policy) {
            TunExclusionPolicy.Union -> return false
            is TunExclusionPolicy.SystemBudget -> policy
        }
        val isIPv6 = ':' in value
        val parts = value.split('/')
        val length = when (parts.size) {
            1 -> if (isIPv6) 128L else 32L
            2 -> prefixLength(parts[1]) ?: return false
            else -> return false
        }
        return length > if (isIPv6) budget.maxIPv6PrefixLength else budget.maxIPv4PrefixLength
    }

    // 与 iOS 的整数解析同判据（可带一个正负号、只认 ASCII 数字、64 位）：toLongOrNull 另认 Unicode 数字。
    private fun prefixLength(text: String): Long? =
        if (text.all { it in '0'..'9' || it == '+' || it == '-' }) text.toLongOrNull() else null

    // 放在规则数组首位、只匹配 TUN 入站：与交给系统的排除同语义——命中即直连，不经嗅探、
    // DNS 劫持与后续任何规则；其它入站（如本地代理入站）不受影响。
    private fun prependTunDirectRule(
        template: JsonValue.JsonObject,
        templateTun: JsonValue.JsonObject,
        cidrs: List<String>,
    ) {
        val tunTag = (templateTun.get("tag") as? JsonValue.JsonString)?.value
            ?: error("template tun inbound must have a tag")
        val directTag = directOutboundTag(template) ?: error("template must have a direct outbound")
        val route = template.get("route") as? JsonValue.JsonObject ?: error("template must have a route object")
        val rule = JsonValue.JsonObject()
        rule.set("inbound", JsonValue.JsonArray(mutableListOf(JsonValue.JsonString(tunTag))))
        rule.set("ip_cidr", JsonValue.JsonArray(cidrs.mapTo(mutableListOf()) { JsonValue.JsonString(it) }))
        rule.set("outbound", JsonValue.JsonString(directTag))
        targetArray(route, "rules").items.add(0, rule)
    }

    private fun directOutboundTag(template: JsonValue.JsonObject): String? {
        val outbounds = template.get("outbounds") as? JsonValue.JsonArray ?: return null
        for (item in outbounds.items) {
            val outbound = item as? JsonValue.JsonObject ?: continue
            if ((outbound.get("type") as? JsonValue.JsonString)?.value == "direct") {
                return (outbound.get("tag") as? JsonValue.JsonString)?.value
            }
        }
        return null
    }

    private fun firstTunInbound(config: JsonValue.JsonObject): JsonValue.JsonObject? {
        val inbounds = config.get("inbounds") as? JsonValue.JsonArray ?: return null
        for (item in inbounds.items) {
            val inbound = item as? JsonValue.JsonObject ?: continue
            if ((inbound.get("type") as? JsonValue.JsonString)?.value == "tun") return inbound
        }
        return null
    }

    // 节点注入：候选逐项校验（对象、字符串 type 非剔除集、非空字符串 tag——不满足者跳过，外部输入领域行为）；
    // 重复 tag 跳过；注入节点 set domain_resolver，tag 追加进出口选择组与自动组，节点按序追加模板 outbounds 尾部。
    private fun injectNodes(template: JsonValue.JsonObject, imported: JsonValue.JsonObject) {
        val importedOutbounds = imported.get("outbounds") as? JsonValue.JsonArray ?: return
        val templateOutbounds = template.get("outbounds")
        require(templateOutbounds is JsonValue.JsonArray) { "template outbounds must be an array" }
        require(templateOutbounds.items.size >= 3) { "template outbounds must have at least 3 entries" }
        val selectorTags = groupTags(templateOutbounds.items[1], "selector")
        val autoTags = groupTags(templateOutbounds.items[2], "urltest")
        val existingTags = mutableSetOf<String>()
        for (item in templateOutbounds.items) {
            val tag = ((item as? JsonValue.JsonObject)?.get("tag") as? JsonValue.JsonString)?.value
            if (tag != null) existingTags.add(tag)
        }
        for (item in importedOutbounds.items) {
            val node = item as? JsonValue.JsonObject ?: continue
            val type = (node.get("type") as? JsonValue.JsonString)?.value ?: continue
            if (type in EXCLUDED_OUTBOUND_TYPES) continue
            val tag = (node.get("tag") as? JsonValue.JsonString)?.value ?: continue
            if (tag.isEmpty()) continue
            if (!existingTags.add(tag)) continue
            node.set("domain_resolver", JsonValue.JsonString("system"))
            selectorTags.items.add(JsonValue.JsonString(tag))
            autoTags.items.add(JsonValue.JsonString(tag))
            templateOutbounds.items.add(node)
        }
    }

    // 路径中已存在的节点必须是对象：模板是本仓资产，类型不符即崩溃。
    // 错误文案不提写者：键路径写入是通用操作。
    private fun writeKeyPath(root: JsonValue.JsonObject, key: String, value: JsonValue) {
        val segments = key.split('.')
        var node = root
        for (index in 0 until segments.size - 1) {
            val segment = segments[index]
            val existing = node.get(segment)
            node = if (existing == null) {
                JsonValue.JsonObject().also { node.set(segment, it) }
            } else {
                require(existing is JsonValue.JsonObject) { "config path segment $segment must be an object" }
                existing
            }
        }
        node.set(segments.last(), value)
    }

    // 出口选择组/自动组前置（模板结构非法即崩溃）：对象、type 匹配、有 outbounds 数组。
    private fun groupTags(item: JsonValue, expectedType: String): JsonValue.JsonArray {
        require(item is JsonValue.JsonObject) { "template outbound group must be an object" }
        require((item.get("type") as? JsonValue.JsonString)?.value == expectedType) {
            "template outbound group must have type $expectedType"
        }
        val tags = item.get("outbounds")
        require(tags is JsonValue.JsonArray) { "template outbound group must have an outbounds array" }
        return tags
    }

    // 目标数组：缺失即创建；已存在须为数组（模板/锚点是本仓资产，类型不符即崩溃）。
    private fun targetArray(owner: JsonValue.JsonObject, field: String): JsonValue.JsonArray {
        val existing = owner.get(field)
        if (existing == null) {
            val created = JsonValue.JsonArray(mutableListOf())
            owner.set(field, created)
            return created
        }
        require(existing is JsonValue.JsonArray) { "field $field must be an array" }
        return existing
    }

    private fun stringItems(array: JsonValue.JsonArray?): List<String> =
        array?.items?.filterIsInstance<JsonValue.JsonString>()?.map { it.value } ?: emptyList()

    private fun matcherField(kind: RuleKind): String = when (kind) {
        RuleKind.DOMAIN -> "domain"
        RuleKind.DOMAIN_SUFFIX -> "domain_suffix"
        RuleKind.IP_CIDR -> "ip_cidr"
    }

    private fun actionToken(action: RuleAction): String = when (action) {
        RuleAction.REJECT -> "reject"
        RuleAction.DIRECT -> "direct"
        RuleAction.PROXY -> "proxy"
    }

    // 空白判定只认 JSON 空白四字符（镜像 ConfigCheck）：两端原生 trim 的 Unicode 空白集不一致，自实现保对等。
    private fun isBlank(s: String): Boolean = s.all { it == ' ' || it == '\t' || it == '\n' || it == '\r' }
}
