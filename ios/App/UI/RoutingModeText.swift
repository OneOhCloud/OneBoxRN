import Core

/// 路由模式的展示词：首页分段与设置页取值行读同一处，文案不各写一份。
enum RoutingModeText {
    /// 列出的顺序即各处的展示顺序。
    static let all: [RoutingMode] = [.tunRules, .tunGlobal]

    static func labelKey(_ mode: RoutingMode) -> String {
        switch mode {
        case .tunRules: return "settings_routing_mode_rules"
        case .tunGlobal: return "settings_routing_mode_global"
        }
    }
}
