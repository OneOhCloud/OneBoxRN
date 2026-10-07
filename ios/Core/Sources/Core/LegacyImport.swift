import Foundation

// 上一代应用（同 bundle id、覆盖安装升级而来）留在本机 kv_store 里的数据：首次启动时一次性换算进本应用。
// 读库与「只做一次」的记账在平台层；本文件只做纯换算（plan）与落库（apply），两端逐字对应
// Android core/LegacyImport.kt，golden/legacy-import.json 是行为裁判。
//
// 上一代的持久化键是对外不可改的历史事实，故在此逐字列出：
//   sub_ids（id 数组 JSON）/ sub_<id>（profile JSON）/ active_sub_id —— 多配置格式；
//   configLink / configName / usedTraffic / totalTraffic / expireTime / configContent —— 更早的单配置格式，
//     sub_migration_v1 == "1" 表示上一代已把它并入多配置格式；
//   mode —— 路由模式 token；custom_ruleset_<action> —— 自定义规则（domain / domain_suffix / ip_cidr 三组数组）。

/// 换算出的一条配置：上一代只有这些字段，id 与刷新时刻由落库时补。
public struct LegacyProfile: Sendable, Equatable {
    public let name: String
    public let url: String
    public let usedTraffic: Int64
    public let totalTraffic: Int64
    public let expireTime: Int64
    /// 上一代首次导入的时刻（毫秒）；0 = 上一代没记下。
    public let addedAt: Int64
    public let content: String

    public init(
        name: String,
        url: String,
        usedTraffic: Int64,
        totalTraffic: Int64,
        expireTime: Int64,
        addedAt: Int64,
        content: String
    ) {
        self.name = name
        self.url = url
        self.usedTraffic = usedTraffic
        self.totalTraffic = totalTraffic
        self.expireTime = expireTime
        self.addedAt = addedAt
        self.content = content
    }
}

public struct LegacyImportPlan: Sendable, Equatable {
    public let profiles: [LegacyProfile]
    /// 激活项在 `profiles` 中的下标；没有配置时为 nil。
    public let activeIndex: Int?
    public let routingMode: RoutingMode?
    public let rules: [Rule]

    public init(profiles: [LegacyProfile], activeIndex: Int?, routingMode: RoutingMode?, rules: [Rule]) {
        self.profiles = profiles
        self.activeIndex = activeIndex
        self.routingMode = routingMode
        self.rules = rules
    }

    public var isEmpty: Bool { profiles.isEmpty && routingMode == nil && rules.isEmpty }
}

public enum LegacyImport {
    private static let profileIdsKey = "sub_ids"
    private static let activeProfileKey = "active_sub_id"
    private static let singleProfileMigratedKey = "sub_migration_v1"
    private static let modeKey = "mode"

    // 上一代规则的动作与类别 token，声明序即展开序（与本应用的展示序一致）。
    private static let actionTokens: [(RuleAction, String)] = [
        (.reject, "reject"), (.direct, "direct"), (.proxy, "proxy"),
    ]
    private static let kindTokens: [(RuleKind, String)] = [
        (.domain, "domain"), (.domainSuffix, "domain_suffix"), (.ipCidr, "ip_cidr"),
    ]

    public static func plan(_ entries: [String: String]) -> LegacyImportPlan {
        var profiles: [LegacyProfile] = []
        var ids: [String] = []
        var seenUrls = Set<String>()
        for id in profileIds(entries) {
            guard let profile = multiProfile(entries["sub_\(id)"]) else { continue }
            guard seenUrls.insert(profile.url).inserted else { continue }
            profiles.append(profile)
            ids.append(id)
        }
        var activeIndex = entries[activeProfileKey].flatMap { ids.firstIndex(of: $0) }
            ?? (profiles.isEmpty ? nil : 0)
        if let single = singleProfile(entries), seenUrls.insert(single.url).inserted {
            profiles.append(single)
            activeIndex = profiles.count - 1
        }
        return LegacyImportPlan(
            profiles: profiles,
            activeIndex: activeIndex,
            routingMode: RoutingMode.allCases.first { $0.token == entries[modeKey] },
            rules: rules(entries)
        )
    }

    /// 落库：按计划顺序 upsert（同 url 并入既有项），再把激活指针指到计划的激活项。
    /// 上一代没有「最近刷新」时刻：取它的首次导入时刻，没有就取本次导入时刻。
    public static func apply(
        _ plan: LegacyImportPlan,
        profiles: ProfileStore,
        rules: RuleStore,
        newId: () -> String,
        nowMillis: Int64
    ) {
        let stored = plan.profiles.map { legacy -> Profile in
            let stamp = legacy.addedAt > 0 ? legacy.addedAt : nowMillis
            return profiles.upsertByUrl(
                Profile(
                    id: newId(),
                    name: legacy.name,
                    url: legacy.url,
                    usedTraffic: legacy.usedTraffic,
                    totalTraffic: legacy.totalTraffic,
                    expireTime: legacy.expireTime,
                    addedAt: stamp,
                    updatedAt: stamp,
                    website: nil
                ),
                content: legacy.content
            )
        }
        if let index = plan.activeIndex { profiles.setActive(stored[index].id) }
        if !plan.rules.isEmpty { rules.add(plan.rules) }
    }

    private static func profileIds(_ entries: [String: String]) -> [String] {
        guard case .jsonArray(let array)? = parseOrNil(entries[profileIdsKey]) else { return [] }
        return array.items.compactMap { item in
            if case .jsonString(let id) = item { return id }
            return nil
        }
    }

    private static func multiProfile(_ raw: String?) -> LegacyProfile? {
        guard case .jsonObject(let object)? = parseOrNil(raw) else { return nil }
        let url = string(object, "url")
        guard !url.isEmpty else { return nil }
        let name = string(object, "name")
        return LegacyProfile(
            name: name.isEmpty ? ProfileName.derive(contentDisposition: "", existingName: "", url: url) : name,
            url: url,
            usedTraffic: number(object.get("usedTraffic")),
            totalTraffic: number(object.get("totalTraffic")),
            expireTime: number(object.get("expireTime")),
            addedAt: number(object.get("addedAt")),
            content: string(object, "configContent")
        )
    }

    private static func singleProfile(_ entries: [String: String]) -> LegacyProfile? {
        guard entries[singleProfileMigratedKey] != "1" else { return nil }
        let url = entries["configLink"] ?? ""
        guard !url.isEmpty else { return nil }
        // 上一代以 "default" 作「未命名」的占位名。
        let configName = entries["configName"] ?? ""
        let existing = configName == "default" ? "" : configName
        return LegacyProfile(
            name: ProfileName.derive(contentDisposition: "", existingName: existing, url: url),
            url: url,
            usedTraffic: number(entries["usedTraffic"]),
            totalTraffic: number(entries["totalTraffic"]),
            expireTime: number(entries["expireTime"]),
            addedAt: 0,
            content: entries["configContent"] ?? ""
        )
    }

    private static func rules(_ entries: [String: String]) -> [Rule] {
        var seen = Set<Rule>()
        var ordered: [Rule] = []
        for (action, actionToken) in actionTokens {
            guard case .jsonObject(let set)? = parseOrNil(entries["custom_ruleset_\(actionToken)"]) else { continue }
            for (kind, kindToken) in kindTokens {
                guard case .jsonArray(let values)? = set.get(kindToken) else { continue }
                for item in values.items {
                    guard case .jsonString(let raw) = item else { continue }
                    let value = RuleToken.normalize(raw)
                    guard RuleToken.validate(kind: kind, value: value) else { continue }
                    let rule = Rule(action: action, kind: kind, value: value)
                    if seen.insert(rule).inserted { ordered.append(rule) }
                }
            }
        }
        return ordered
    }

    // 上一代的值是它自己写下的，但跨版本、跨崩溃的残片可能是坏的：坏一条只丢那一条，不拖累其余。
    private static func parseOrNil(_ raw: String?) -> JsonValue? {
        guard let raw else { return nil }
        return try? Json.parse(raw)
    }

    private static func string(_ object: JsonObject, _ key: String) -> String {
        if case .jsonString(let value)? = object.get(key) { return value }
        return ""
    }

    private static func number(_ value: JsonValue?) -> Int64 {
        if case .jsonNumber(let lexeme)? = value { return number(lexeme) }
        return 0
    }

    // 缺失与不可读一律 0：本应用里 0 即「上游没给」（见 Userinfo）。
    private static func number(_ raw: String?) -> Int64 {
        guard let raw, let double = Double(raw), double.isFinite,
              double >= Double(Int64.min), double < Double(Int64.max) else { return 0 }
        return Int64(double)
    }
}
