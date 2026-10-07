import Core
import SwiftUI

// 设置页。
//
// **没有页面标题**：各张分组卡的语义已自解释，再加一个「设置」大标题只是重复 dock 上那个标签。
//
// 本页同时是除首页与配置页之外全部功能的入口，但首屏只摆常用的。
// 行按「用户的心智动作」分组，而不是按实现模块分：怎么走网（路由模式、区域、规则）、
// 往深处去（诊断、高级设置——各自收进二级页）、关于（这是什么、谁做的）。
// 日志、统计这类普通用户用不到的入口不在首屏平铺。
struct SettingsScreen: View {
    @State private var vm: SettingsViewModel
    @State private var showAbout = false
    private let open: (AppNav.SettingsRoute) -> Void

    init(actions: AppActions, open: @escaping (AppNav.SettingsRoute) -> Void) {
        _vm = State(initialValue: SettingsViewModel(actions: actions))
        self.open = open
    }

    var body: some View {
        @Bindable var vm = vm
        ScrollView {
            VStack(alignment: .leading, spacing: SettingsLayout.cardGap) {
                preferencesGroup
                deeperGroup
                aboutGroup
                versionFooter
            }
            .pageInsets(top: Theme.Spacing.large)
        }
        .screenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showAbout) {
            AboutSheet(
                vm: vm,
                onOpenRefreshRecords: { open(.refreshRecords) },
                onOpenEngineInfo: { open(.engineInfo) }
            )
        }
        .alert(tr("settings_link_error"), isPresented: $vm.linkErrorVisible) {}
        .contentSwapTransition(vm.connected)
        .task(id: vm.dnsInputRevision) {
            await vm.refreshDnsServer()
        }
    }

    // —— 1. 偏好 ——

    // **两个可变值行必须同处一组**：路由模式与区域——区域是一个可变偏好，不是一条关于信息。
    private var preferencesGroup: some View {
        SettingsGroup(label: nil) {
            ChoiceRow(
                label: tr("settings_routing_mode_label"),
                systemImage: "arrow.triangle.branch",
                // 网络 / 连接族（这一行是**派生**）。
                iconFamily: .networking,
                options: RoutingModeText.all.map { ($0, tr(RoutingModeText.labelKey($0)), true) },
                selection: vm.routingMode,
                onSelect: vm.selectRoutingMode
            )
            ChoiceRow(
                label: tr("settings_region_label"),
                systemImage: "globe.asia.australia",
                // 网络 / 连接族 —— ✅ **参考直接对位**（`language.tsx` / `lan.tsx` 的 `Globe` / `Router`）。
                iconFamily: .networking,
                // 可选性取自 core Region.available（两端共读的唯一声明），不在此硬编码禁用名单。
                options: Region.allCases.map { ($0, tr(Self.regionKey($0)), $0.available) },
                selection: vm.region,
                onSelect: vm.selectRegion
            )
            NavRow(
                label: tr("settings_rules"),
                systemImage: "list.bullet.rectangle",
                action: { open(.rules) }
            )
        }
    }


    // —— 2. 往深处去 ——

    // 两个二级入口：诊断（出问题去哪看）、高级设置（我知道自己在做什么）。
    // 开发者页不设常驻入口，由版本页脚三连点直达。
    private var deeperGroup: some View {
        SettingsGroup(label: nil) {
            NavRow(label: tr("settings_diagnostics"), systemImage: "stethoscope", action: { open(.diagnostics) })
            NavRow(
                label: tr("settings_advanced_label"),
                // 不用齿轮一族（与 dock 的「设置」齿轮撞）：
                // 高级设置页里收的是几个开关与参数，开关形直白。
                systemImage: "switch.2",
                action: { open(.advanced) }
            )
        }
    }

    // —— 3. 关于 ——

    // 只有一行：区域在偏好组。
    private var aboutGroup: some View {
        SettingsGroup(label: nil) {
            NavRow(
                label: tr("settings_about"),
                systemImage: "info.circle",
                action: openAbout
            )
        }
    }

    private func openAbout() {
        showAbout = true
    }

    private static func regionKey(_ region: Region) -> String {
        switch region {
        case .cn: return "settings_region_cn"
        case .ir: return "settings_region_ir"
        case .ru: return "settings_region_ru"
        }
    }

    // —— 版本页脚 ——

    // 滚动内容末项（整页单一滚动流，不固定底部）；版本串 v<app>-<engine>。
    //
    // **这里不加顶部内衬**：与上一张分组卡的间距**由外层 VStack 的
    // `SettingsLayout.cardGap`(20) 给**，本件不自己加。
    private var versionFooter: some View {
        Text(versionText)
            .font(Theme.TypeScale.meta.monospacedDigit())
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            // 连点进开发者页与长按切 build 号并存，互不吞没。
            // 解锁静默无触感——触感只有五种语义，隐藏手势不在其内，不为它扩词表。
            .onTapGesture { if vm.tapVersion() { open(.dev) } }
            .onLongPressGesture { vm.toggleBuildNumber() }
    }

    private var versionText: String {
        if vm.showBuildNumber {
            return tr("settings_version_build", vm.versionLabel, vm.buildNumber)
        }
        return tr("settings_version", vm.versionLabel)
    }
}

enum SettingsLayout {
    /// 分组卡之间。
    static let cardGap: CGFloat = 20
}

/// 外链打开结果回调（必须 nonisolated）：系统打开服务不保证在主线程投递结果，
/// 而在 MainActor 上下文里就地写的闭包会继承 MainActor 隔离、入口即断言执行器——
/// 结果落在别的队列上时那条断言必然失败并 trap（点「官网」当场崩）。
/// 故回调本身不带隔离，失败分支自己 hop 回 MainActor 再写状态。
func linkOpenCompletion(
    onFailure: @escaping @MainActor @Sendable () -> Void
) -> @Sendable (Bool) -> Void {
    { accepted in
        guard !accepted else { return }
        Task { @MainActor in onFailure() }
    }
}
