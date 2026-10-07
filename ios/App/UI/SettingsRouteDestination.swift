import Core
import SwiftUI

/// 设置栈里每条路由的目的地。消费方是主窗的设置标签页（`AppNav.settingsStack`）。
///
/// 单独成件是为了**把「目的地是什么」与「由谁呈现」分开**。
struct SettingsRouteDestination: View {
    let route: AppNav.SettingsRoute
    let actions: AppActions
    /// 目的地内部要再推一层时用它（诊断 → 子页、开发者 → 更新记录 / 关于引擎）。
    let push: (AppNav.SettingsRoute) -> Void

    @ViewBuilder
    var body: some View {
        switch route {
        case .rules:
            RulesScreen(actions: actions)
        case .diagnostics:
            DiagnosticsScreen(actions: actions, open: push)
        case .advanced:
            AdvancedSettingsScreen(actions: actions)
        case .logs:
            LogsScreen(store: actions.logStore)
        case .config:
            ConfigScreen(actions: actions)
        case .stats:
            StatsScreen(actions: actions)
        case .usage:
            // 本机用量看的是**激活配置**的账本。无激活项时设置页那一行已禁用（点不进来），
            // 故这里只可能在有激活项时被求值；用 `ProfilesScreen` 那条同样的可空写法，
            // 不断言——路由的求值与设置页的门控不在同一次视图更新里。
            usageDestination
        case .dev:
            DevScreen(
                actions: actions,
                onOpenRecords: { push(.refreshRecords) },
                onOpenEngineInfo: { push(.engineInfo) }
            )
        case .refreshRecords:
            RefreshRecordsScreen(actions: actions)
        case .engineInfo:
            EngineInfoScreen()
        }
    }

    @ViewBuilder
    private var usageDestination: some View {
        if let profile = actions.activeProfile {
            UsageScreen(actions: actions, profileId: profile.id, profileName: profile.name)
        }
    }
}
