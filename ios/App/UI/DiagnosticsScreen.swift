import SwiftUI

// 诊断页：出了问题去哪看——本机用量、运行统计、日志与合并后的配置。
//
// 行序按普通用户最可能先找的那一项排：先看用了多少、再看此刻在跑什么、最后才是日志与配置原文。
struct DiagnosticsScreen: View {
    @State private var vm: SettingsViewModel
    private let open: (AppNav.SettingsRoute) -> Void

    init(actions: AppActions, open: @escaping (AppNav.SettingsRoute) -> Void) {
        _vm = State(initialValue: SettingsViewModel(actions: actions))
        self.open = open
    }

    var body: some View {
        ScrollView {
            // 无组标题：顶栏已经是「诊断」，组标题会把同一句话说两遍。
            SettingsGroup(label: nil) {
                NavRow(label: tr("settings_usage"), systemImage: "chart.line.uptrend.xyaxis", action: { open(.usage) })
                    // 本机用量是某一份配置的账本；没有激活项时这一行点不动（禁用而非隐藏：
                    // 让用户看得见有这么个东西，而不是纳闷它去哪了）。
                    .disabled(!vm.hasActiveProfile)
                NavRow(label: tr("settings_stats"), systemImage: "chart.bar", action: { open(.stats) })
                NavRow(label: tr("settings_logs"), systemImage: "text.alignleft", action: { open(.logs) })
                NavRow(label: tr("settings_config"), systemImage: "doc.text", action: { open(.config) })
            }
            .pageInsets(top: Theme.Spacing.large)
        }
        .screenBackground()
        .navigationTitle(tr("settings_diagnostics"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
