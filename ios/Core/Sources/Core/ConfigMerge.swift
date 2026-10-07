import Foundation

// 配置合并：从（导入原文、模板、路由模式、规则列表、
// 日志级别、直连 DNS、TUN 排除字段名）到引擎实际接收配置的确定性纯函数——无 IO、无时钟、无平台分支。
// 与 Android core/ConfigMerge.kt 逐字对应，golden/config-merge.json 是行为裁判。
// 错误两分：导入内容来自外部 → MergeError 领域错误；模板/锚点是本仓资产 → 崩溃。

/// 两段路由模式：枚举与 token 双射，无第三态。
public enum RoutingMode: CaseIterable, Sendable {
    case tunRules
    case tunGlobal

    public var token: String {
        switch self {
        case .tunRules: return "tun-rules"
        case .tunGlobal: return "tun-global"
        }
    }

    /// token↔枚举映射唯一实现：未知 token 即枚举穷尽破坏，崩溃暴露。
    public static func fromToken(_ token: String) -> RoutingMode {
        guard let mode = allCases.first(where: { $0.token == token }) else {
            preconditionFailure("unknown routing mode token: \(token)")
        }
        return mode
    }
}

/// 配置编译不成立的领域错误（导入内容不可合并，或合并产物不满足入站改写的前提）：
/// 查看页可重试态，启动路径映射为启动失败。
public struct MergeError: Error {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }
}

/// TUN 排除项交给谁执行。
///
/// 系统路由表里的每一条排除都常驻在系统守护进程里（nesessionmanager / configd），数千条会把
/// 它们推过自身的内存高水位，系统一有内存压力就被清理，VPN 会话随之被系统停掉。于是 iOS 上
/// 只把大网段交给系统（日常流量几乎都落在这些大网段里），更细的交给引擎直连。
public enum TunExclusionPolicy: Sendable, Equatable {
    /// 导入值全部并入模板的 TUN 排除字段，由平台整体执行。
    case union
    /// 前缀不长于门限的导入排除交给系统；更长的编译成最前置、限定 TUN 入站的直连规则。
    case systemBudget(maxIPv4PrefixLength: Int, maxIPv6PrefixLength: Int)
}

/// 合并输入全集：纯函数入参，平台差异只经 tunExcludeField 与 tunExclusionPolicy 注入。
public struct MergeInput: Sendable {
    public let importedConfig: String
    public let template: String
    public let mode: RoutingMode
    public let rules: [Rule]
    public let logLevel: String
    public let directDns: String
    public let tunExcludeField: String
    public let tunExclusionPolicy: TunExclusionPolicy

    public init(
        importedConfig: String,
        template: String,
        mode: RoutingMode,
        rules: [Rule],
        logLevel: String,
        directDns: String,
        tunExcludeField: String,
        tunExclusionPolicy: TunExclusionPolicy
    ) {
        self.importedConfig = importedConfig
        self.template = template
        self.mode = mode
        self.rules = rules
        self.logLevel = logLevel
        self.directDns = directDns
        self.tunExcludeField = tunExcludeField
        self.tunExclusionPolicy = tunExclusionPolicy
    }
}

public enum ConfigMerge {
    /// 平台 TUN 排除字段名：core 内不做平台分支，由调用方注入其一。
    public static let tunExcludeAndroid = "exclude_package"
    public static let tunExcludeApple = "route_exclude_address"

    /// iOS 的系统路由预算：IPv4 ≤ /16、IPv6 ≤ /32 交给系统。取值依据：主流国内站点解析出的
    /// 地址全部落在这两档以内，而条数从近万降到两千多，系统守护进程的常驻离高水位留出余量。
    public static let iosTunExclusionPolicy = TunExclusionPolicy.systemBudget(
        maxIPv4PrefixLength: 16,
        maxIPv6PrefixLength: 32
    )

    /// 内置回退公共 DNS：该字面量在代码中唯一出处即此。
    private static let fallbackDirectDns = "119.29.29.29"

    /// 组/功能型 outbound 不是节点，剔除不注入。
    /// public 供查看页「+N 出站」展示派生消费同一集合（单一来源）。
    public static let excludedOutboundTypes: Set<String> = ["selector", "urltest", "direct", "block", "dns"]

    /// 流水线序：解析 → 规则注入（仅 tun-rules）→ DNS 改写 → 级别覆盖 → 剥离 → TUN 并集 →
    /// 节点注入 → 引擎参数注入 → 编码。
    /// 导入内容的处理上限：下载期已卡一次，此处是**本地编译边界的兜底**——
    /// 已存档的超大配置（旧版本写入、或抓取侧将来出缺陷）不得绕过。放在合并入口而不是各调用点：
    /// 启动路径与配置查看页共用同一入口，分散检查必然漏一处。
    public static let maxImportedConfigSize = 4 * 1024 * 1024

    /// 合并输出上限：注入会让输出大于输入，故不等于上一条。
    public static let maxCompiledConfigSize = maxImportedConfigSize * 2

    public static func merge(_ input: MergeInput) throws -> String {
        if input.importedConfig.utf8.count > maxImportedConfigSize {
            // 内容来自外部 → 领域错误，不崩溃。
            throw MergeError("imported config exceeds processing limit")
        }
        let imported = try parseImported(input.importedConfig)
        let template = parseTemplate(input.template)
        switch input.mode {
        case .tunRules: injectRules(into: template, rules: input.rules)
        case .tunGlobal: break
        }
        rewriteDirectDns(in: template, directDns: input.directDns)
        overrideLogLevel(in: template, logLevel: input.logLevel)
        stripClashApi(in: template)
        enableRuleSetCache(in: template)
        persistFakeIpMapping(in: template)
        unionTunExclusions(template: template, imported: imported, input: input)
        injectNodes(template: template, imported: imported)
        let compiled = Json.encode(.jsonObject(template))
        // 输出上限：合法的导入内容也可能在注入后膨胀（超长 tag 会在节点与两个分组里
        // 各出现一次），故出口另有一道。与入口同在合并函数内——它是两端唯一的合并出口。
        if compiled.utf8.count > maxCompiledConfigSize {
            throw MergeError("compiled config exceeds processing limit")
        }
        return compiled
    }

    // 导入内容来自外部：解析失败/顶层非对象在此边界转类型化领域错误。
    private static func parseImported(_ text: String) throws -> JsonObject {
        let parsed: JsonValue
        do {
            parsed = try Json.parse(text)
        } catch let rejected as JsonError {
            throw MergeError("imported config is not valid JSON: \(rejected.message)")
        }
        guard case .jsonObject(let object) = parsed else {
            throw MergeError("imported config top-level must be an object")
        }
        return object
    }

    // 模板是本仓资产：解析失败/顶层非对象即崩溃。
    private static func parseTemplate(_ text: String) -> JsonObject {
        let parsed: JsonValue
        do {
            parsed = try Json.parse(text)
        } catch {
            preconditionFailure("template is not valid JSON: \(error)")
        }
        guard case .jsonObject(let object) = parsed else {
            preconditionFailure("template top-level must be an object")
        }
        return object
    }

    // 规则注入（仅 tun-rules）：按 action 分组保入参序；route.rules 缺失即无锚点可命中，全部静默跳过；
    // 单 action 锚点缺失亦静默跳过（镜像 RN 的行为，golden 锁定，非吞错）；绝不改锚点的 action/outbound。
    private static func injectRules(into template: JsonObject, rules: [Rule]) {
        guard let routeRules = arrayValue(objectValue(template.get("route"))?.get("rules")) else { return }
        for action in RuleAction.allCases {
            let group = rules.filter { $0.action == action }
            if group.isEmpty { continue }
            guard let anchor = findAnchor(in: routeRules, token: actionToken(action)) else { continue }
            for rule in group {
                targetArray(on: anchor, field: matcherField(rule.kind)).items.append(.jsonString(rule.value))
            }
        }
    }

    // 锚点判定：首条「domain 数组含以 "<action>-tag." 开头字符串」的 rule。
    // 有意差异：RN 用完整锚点字面量比对，本仓改前缀匹配以免域名字面量入仓；对真实模板二者选中同一条。
    private static func findAnchor(in routeRules: JsonArray, token: String) -> JsonObject? {
        let prefix = "\(token)-tag."
        for item in routeRules.items {
            guard case .jsonObject(let rule) = item, let domains = arrayValue(rule.get("domain")) else { continue }
            let hit = domains.items.contains { entry in
                if case .jsonString(let value) = entry { return value.hasPrefix(prefix) }
                return false
            }
            if hit { return rule }
        }
        return nil
    }

    // 直连 DNS 改写：首条 tag=="system" 项 set type/server/server_port；dns/servers 缺失或无 system 项 → 空操作。
    private static func rewriteDirectDns(in template: JsonObject, directDns: String) {
        guard let servers = arrayValue(objectValue(template.get("dns"))?.get("servers")) else { return }
        guard let system = firstSystemServer(servers) else { return }
        let server = resolveDirectDns(directDns, system: system)
        system.set("type", .jsonString("udp"))
        system.set("server", .jsonString(server))
        system.set("server_port", .jsonNumber("53"))
    }

    private static func firstSystemServer(_ servers: JsonArray) -> JsonObject? {
        for item in servers.items {
            if case .jsonObject(let server) = item, stringValue(server.get("tag")) == "system" {
                return server
            }
        }
        return nil
    }

    // server 三级取值：参数非空 → 参数；模板原值为非空白字符串 → 原值；否则内置回退。
    private static func resolveDirectDns(_ directDns: String, system: JsonObject) -> String {
        if !directDns.isEmpty { return directDns }
        if let original = stringValue(system.get("server")), !isBlank(original) { return original }
        return fallbackDirectDns
    }

    // 日志级别覆盖：模板自带值一律被覆盖；log 节缺失则创建。
    private static func overrideLogLevel(in template: JsonObject, logLevel: String) {
        guard let existing = template.get("log") else {
            let log = JsonObject()
            log.set("level", .jsonString(logLevel))
            template.set("log", .jsonObject(log))
            return
        }
        guard case .jsonObject(let log) = existing else {
            preconditionFailure("template log must be an object")
        }
        log.set("level", .jsonString(logLevel))
    }

    // 剥离 clash_api：experimental 节缺失时空操作，其余字段保留。
    private static func stripClashApi(in template: JsonObject) {
        objectValue(template.get("experimental"))?.remove("clash_api")
    }

    // 启用规则集缓存：`experimental.cache_file.enabled` 置真，缺失的中间层就地创建。
    //
    // WHY 取值不听凭模板：模板是抓取来的外部资产，而这个开关缺省关闭时引擎走内存缓存，
    // 于是每一次启动都要把全部远端规则集重下一遍——那一步就压在 engine.start() 的阻塞路径上，
    // 宿主的启动预算量的正是它。上游改一笔模板就能把这条静默关回去，故与剥离 clash_api 同姿势：
    // `experimental` 节由合并管线决定。
    //
    // 不注入 `path`：两端 setup() 都把进程工作目录设成各自的引擎工作目录，而引擎的缺省缓存路径
    // 是相对名，缺省即落在该目录内。注入绝对路径会把平台差异带进纯函数。
    private static func enableRuleSetCache(in template: JsonObject) {
        writeKeyPath(in: template, key: "experimental.cache_file.enabled", value: .jsonBool(true))
    }

    // 引擎重建实例时内存 FakeIP 库会丢，系统却仍持有旧应答：映射不落盘，旧地址就查无域名或被改判给别的域名。
    private static func persistFakeIpMapping(in template: JsonObject) {
        writeKeyPath(in: template, key: "experimental.cache_file.store_fakeip", value: .jsonBool(true))
    }

    // TUN 绕行并集：模板值保序在前 + 导入值去重按序追加；任一侧无 TUN inbound 或导入值为空 → 空操作。
    // systemBudget 下超门限的导入值不进并集，改编译成一条直连规则（见 TunExclusionPolicy）。
    private static func unionTunExclusions(template: JsonObject, imported: JsonObject, input: MergeInput) {
        let field = input.tunExcludeField
        guard let importedTun = firstTunInbound(imported) else { return }
        guard let templateTun = firstTunInbound(template) else { return }
        let userValues = stringItems(arrayValue(importedTun.get(field)))
        if userValues.isEmpty { return }
        let target = targetArray(on: templateTun, field: field)
        var seen = Set(stringItems(target))
        var engineCidrs: [String] = []
        var engineSeen = Set<String>()
        for value in userValues {
            if exceedsSystemBudget(value, policy: input.tunExclusionPolicy) {
                if engineSeen.insert(value).inserted { engineCidrs.append(value) }
            } else if seen.insert(value).inserted {
                target.items.append(.jsonString(value))
            }
        }
        if !engineCidrs.isEmpty {
            prependTunDirectRule(template: template, templateTun: templateTun, cidrs: engineCidrs)
        }
    }

    // 只看前缀长度与地址族：地址本身的合法性由引擎在解析期校验（坏值照样 fail-loud）。
    // 不带前缀长度的单个地址按主机路由（/32、/128）计。前缀长度不是整数的值留在并集里，同样交给引擎拒绝。
    private static func exceedsSystemBudget(_ value: String, policy: TunExclusionPolicy) -> Bool {
        guard case .systemBudget(let maxIPv4, let maxIPv6) = policy else { return false }
        let isIPv6 = value.contains(":")
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        let length: Int
        switch parts.count {
        case 1: length = isIPv6 ? 128 : 32
        case 2:
            guard let parsed = Int(parts[1]) else { return false }
            length = parsed
        default: return false
        }
        return length > (isIPv6 ? maxIPv6 : maxIPv4)
    }

    // 放在规则数组首位、只匹配 TUN 入站：与交给系统的排除同语义——命中即直连，不经嗅探、
    // DNS 劫持与后续任何规则；其它入站（如本地代理入站）不受影响。
    private static func prependTunDirectRule(template: JsonObject, templateTun: JsonObject, cidrs: [String]) {
        guard let tunTag = stringValue(templateTun.get("tag")) else {
            preconditionFailure("template tun inbound must have a tag")
        }
        guard let directTag = directOutboundTag(template) else {
            preconditionFailure("template must have a direct outbound")
        }
        guard let route = objectValue(template.get("route")) else {
            preconditionFailure("template must have a route object")
        }
        let rule = JsonObject()
        rule.set("inbound", .jsonArray(JsonArray([.jsonString(tunTag)])))
        rule.set("ip_cidr", .jsonArray(JsonArray(cidrs.map { .jsonString($0) })))
        rule.set("outbound", .jsonString(directTag))
        targetArray(on: route, field: "rules").items.insert(.jsonObject(rule), at: 0)
    }

    private static func directOutboundTag(_ template: JsonObject) -> String? {
        for item in arrayValue(template.get("outbounds"))?.items ?? [] {
            if let outbound = objectValue(item), stringValue(outbound.get("type")) == "direct" {
                return stringValue(outbound.get("tag"))
            }
        }
        return nil
    }

    private static func firstTunInbound(_ config: JsonObject) -> JsonObject? {
        guard let inbounds = arrayValue(config.get("inbounds")) else { return nil }
        for item in inbounds.items {
            if case .jsonObject(let inbound) = item, stringValue(inbound.get("type")) == "tun" {
                return inbound
            }
        }
        return nil
    }

    // 节点注入：候选逐项校验（对象、字符串 type 非剔除集、非空字符串 tag——不满足者跳过，外部输入领域行为）；
    // 重复 tag 跳过；注入节点 set domain_resolver，tag 追加进出口选择组与自动组，节点按序追加模板 outbounds 尾部。
    private static func injectNodes(template: JsonObject, imported: JsonObject) {
        guard let importedOutbounds = arrayValue(imported.get("outbounds")) else { return }
        guard let templateOutbounds = arrayValue(template.get("outbounds")) else {
            preconditionFailure("template outbounds must be an array")
        }
        precondition(templateOutbounds.items.count >= 3, "template outbounds must have at least 3 entries")
        let selectorTags = groupTags(templateOutbounds.items[1], expectedType: "selector")
        let autoTags = groupTags(templateOutbounds.items[2], expectedType: "urltest")
        var existingTags = Set<String>()
        for item in templateOutbounds.items {
            if case .jsonObject(let outbound) = item, let tag = stringValue(outbound.get("tag")) {
                existingTags.insert(tag)
            }
        }
        for item in importedOutbounds.items {
            guard case .jsonObject(let node) = item,
                  let type = stringValue(node.get("type")), !excludedOutboundTypes.contains(type),
                  let tag = stringValue(node.get("tag")), !tag.isEmpty,
                  existingTags.insert(tag).inserted else { continue }
            node.set("domain_resolver", .jsonString("system"))
            selectorTags.items.append(.jsonString(tag))
            autoTags.items.append(.jsonString(tag))
            templateOutbounds.items.append(.jsonObject(node))
        }
    }

    // 路径中已存在的节点必须是对象：模板是本仓资产，类型不符即崩溃。
    // 错误文案不提写者：键路径写入是通用操作。
    private static func writeKeyPath(in root: JsonObject, key: String, value: JsonValue) {
        let segments = key.components(separatedBy: ".")
        var node = root
        for segment in segments.dropLast() {
            if let existing = node.get(segment) {
                guard case .jsonObject(let child) = existing else {
                    preconditionFailure("config path segment \(segment) must be an object")
                }
                node = child
            } else {
                let child = JsonObject()
                node.set(segment, .jsonObject(child))
                node = child
            }
        }
        node.set(segments[segments.count - 1], value)
    }

    // 出口选择组/自动组前置（模板结构非法即崩溃）：对象、type 匹配、有 outbounds 数组。
    private static func groupTags(_ item: JsonValue, expectedType: String) -> JsonArray {
        guard case .jsonObject(let group) = item else {
            preconditionFailure("template outbound group must be an object")
        }
        precondition(
            stringValue(group.get("type")) == expectedType,
            "template outbound group must have type \(expectedType)"
        )
        guard let tags = arrayValue(group.get("outbounds")) else {
            preconditionFailure("template outbound group must have an outbounds array")
        }
        return tags
    }

    // 目标数组：缺失即创建；已存在须为数组（模板/锚点是本仓资产，类型不符即崩溃）。
    private static func targetArray(on owner: JsonObject, field: String) -> JsonArray {
        guard let existing = owner.get(field) else {
            let created = JsonArray([])
            owner.set(field, .jsonArray(created))
            return created
        }
        guard case .jsonArray(let array) = existing else {
            preconditionFailure("field \(field) must be an array")
        }
        return array
    }

    private static func stringItems(_ array: JsonArray?) -> [String] {
        guard let array else { return [] }
        return array.items.compactMap { item in
            if case .jsonString(let value) = item { return value }
            return nil
        }
    }

    private static func matcherField(_ kind: RuleKind) -> String {
        switch kind {
        case .domain: return "domain"
        case .domainSuffix: return "domain_suffix"
        case .ipCidr: return "ip_cidr"
        }
    }

    private static func actionToken(_ action: RuleAction) -> String {
        switch action {
        case .reject: return "reject"
        case .direct: return "direct"
        case .proxy: return "proxy"
        }
    }

    // 空白判定只认 JSON 空白四字符（镜像 ConfigCheck）：两端原生 trim 的 Unicode 空白集不一致，自实现保对等。
    private static func isBlank(_ s: String) -> Bool {
        s.unicodeScalars.allSatisfy { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }
    }

    private static func objectValue(_ value: JsonValue?) -> JsonObject? {
        guard case .jsonObject(let object)? = value else { return nil }
        return object
    }

    private static func arrayValue(_ value: JsonValue?) -> JsonArray? {
        guard case .jsonArray(let array)? = value else { return nil }
        return array
    }

    private static func stringValue(_ value: JsonValue?) -> String? {
        guard case .jsonString(let string)? = value else { return nil }
        return string
    }
}
