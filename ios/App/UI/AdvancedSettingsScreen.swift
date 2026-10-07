import Core
import SwiftUI

// 高级设置页。
//
// 收的是**改平台运行方式、而非产品行为**的那一类设置：保活入口、网络包含范围两条 Toggle。
//
// 无版本页脚：页脚是设置页首屏的收尾件，复制一份到子页会让
// 开发者页的连点入口出现两个宿主。
struct AdvancedSettingsScreen: View {
    @State private var vm: SettingsViewModel

    init(actions: AppActions) {
        // 与设置页共用同一个 ViewModel 类型：两页读的是同一批设置，各建一个会造出第二份真相。
        _vm = State(initialValue: SettingsViewModel(actions: actions))
    }

    var body: some View {
        @Bindable var vm = vm
        ScrollView {
            // 脚注与卡片的间距取 `medium`（`12`）而非 `extraLarge`（`24`）：
            // 它是**这张卡的说明**，不是下一个区块 —— 远了会读成另起一段。
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                advancedSection
                // 常驻页脚明示本页与子页的变更何时生效。不做变更后才弹的一次性提示——
                // 那只有已经动过手的人看得到，而需要知道这件事的恰恰是还没动手的人。
                Text(tr("settings_advanced_apply_hint"))
                    // `11/400`（`footnote`）而非 `11/500`（`meta`）：**说明脚注是 `11` 的第三个角色**。
                    .font(Theme.TypeScale.note)
                    .foregroundStyle(Theme.textSecondary)
            }
            .pageInsets(top: Theme.Spacing.large)
        }
        .screenBackground()
        .navigationTitle(tr("settings_advanced_label"))
        .navigationBarTitleDisplayMode(.inline)
        .alert(tr("settings_on_demand_error"), isPresented: $vm.onDemandErrorVisible) {}
        .contentSwapTransition(vm.onDemandEnabled)
    }

    // 行序 = 标签的简体中文字数升序，同字数保持声明序：按需连接（4）→ 包含所有网络（6）。
    // 例外是「包含 APNs」——依赖行紧随宿主行，不参与排序。
    private var advancedSection: some View {
        // 无 caption：顶栏已经是「高级设置」，组标题会把同一句话说两遍。仓内单组子页
        // （如引擎信息页）本就是这个形。
        SettingsGroup(label: nil) {
            onDemandRow
            includeAllNetworksRow
            // 「包含所有网络」关闭时整行不出现：`excludeAPNs` 只在前者为真时才被系统读取，
            // 此刻它连「不可用」都算不上——那是一条不存在的设置。
            if vm.networkInclusion.includeAllNetworks {
                includeAPNsRow
            }
        }
    }

    private var onDemandRow: some View {
        ToggleRow(
            label: tr("settings_on_demand_label"),
            systemImage: "bolt.badge.automatic",
            isOn: vm.onDemandEnabled,
            onToggle: { vm.setOnDemandEnabled($0) }
        )
        // kill switch 开着时这个开关是它的配套，不接受单独关闭。
        // 禁用而非隐藏——让用户看得见它是开的，也看得见自己关不掉。
        .disabled(vm.onDemandLocked)
    }

    // 两个开关分列（无副文本——同组其余行都没有，单独给它挂一条会把这行撑成两倍高）。
    private var includeAllNetworksRow: some View {
        ToggleRow(
            label: tr("settings_include_all_networks_label"),
            // 无线电波 = 这一行管的是**走哪些网络**。与同组其余行同款：符号只说
            // 「这一行管什么」，**不表达开关此刻在哪一边**——它是静态的，翻不了。
            systemImage: "antenna.radiowaves.left.and.right",
            isOn: vm.networkInclusion.includeAllNetworks,
            onToggle: { vm.setIncludeAllNetworks($0) }
        )
    }

    private var includeAPNsRow: some View {
        ToggleRow(
            label: tr("settings_include_apns_label"),
            // **不是 `bell.slash`**：划掉的铃铛读作「通知被关掉」，
            // 那是一个**状态**，而本行的标签是「**包含** APNs」、`NetworkInclusion` 里
            // 这一项**默认为真** ⇒ 它与标签、与默认值同时相反。
            // 而这枚符号是静态的，它根本翻不了——**能表达状态的位置是开关本身，不是图标列**。
            systemImage: "bell",
            isOn: vm.networkInclusion.includeAPNs,
            onToggle: { vm.setIncludeAPNs($0) }
        )
    }
}
