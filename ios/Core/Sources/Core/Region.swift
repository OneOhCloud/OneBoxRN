// 区域（设置页区域选择）：枚举与 token 双射，无第三态。
// 与 Android core/Region.kt 逐字对应；token 是持久化的稳定标识。
// 本期为纯占位设置：可选与持久化已锁定，零运行时效果（不进配置合并、不触发重启）。
public enum Region: CaseIterable, Sendable {
    case cn
    case ir
    case ru

    public var token: String {
        switch self {
        case .cn: return "cn"
        case .ir: return "ir"
        case .ru: return "ru"
        }
    }

    /// 当前是否可选。可选集合的单一声明处：两端同读，UI 层不另行硬编码禁用名单。
    public var available: Bool {
        switch self {
        case .cn: return true
        case .ir, .ru: return false
        }
    }

    /// token↔枚举映射唯一实现：未知 token 即枚举穷尽破坏，崩溃暴露（fail-fast）。
    public static func fromToken(_ token: String) -> Region {
        guard let region = allCases.first(where: { $0.token == token }) else {
            preconditionFailure("unknown region token: \(token)")
        }
        return region
    }
}
