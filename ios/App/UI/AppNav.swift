import SwiftUI
import Core

// 根导航：三 tab 各自持有独立 NavigationStack 与路径（切 tab 不丢导航位置）。
// 本文件是 UI 层唯一持有真实依赖的装配点：各屏依赖仅经 AppActions 在此注入。
// 另挂全局启动失败弹层：观察 lastError 由空变非空即弹。
struct AppNav: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    private let actions: AppActions

    @State private var tab: AppTab = .home
    // 三条导航路径都由本层持有：切 tab 若重建未选中的视图树，路径留在各屏的 @State 就会随之
    // 丢失，违反「切 tab 不丢导航位置」。某一端恰好不重建不足以立住这条不变量。
    @State private var homePath: [HomeScreen.Route] = []
    @State private var profilesPath: [ProfilesScreen.Route] = []
    @State private var settingsPath: [SettingsRoute] = []
    @State private var startFailure: StartFailurePresentation?
    // 深链待消费载荷：onOpenURL 置位、HomeScreen 消费后清空，
    // 一次性语义保证场景重建不重放；空 url 载荷 = 「导入页默认态」的最简表达（拒绝分支）。
    @State private var pendingImport: ImportPayload?

    enum AppTab: CaseIterable {
        case home
        case profiles
        case settings

        var title: String {
            switch self {
            case .home: return tr("tab_home")
            case .profiles: return tr("tab_profiles")
            case .settings: return tr("tab_settings")
            }
        }

        /// 实心 / 描线是颜色之外的第二通道，但只有配置那枚字形有实心版：主页的仪表与设置的齿轮
        /// 没有，这两个入口的选中靠标签栏自己的选中表达。
        /// 取当前选中页而不是取一个布尔：调用点原先每处都要自己写一遍 `tab == .home`
        /// 这类比较，同一个判断散在三处；传选中页之后比较只发生在这里一处。
        ///
        /// 主页那枚是连接态的读数，指针只认电源砖那三个相位：失败态与砖一致读作「没连上」，
        /// 失败由状态行与失败横幅承担。三个相位取同一族（`bottom`）：换族连表盘与指针枢轴一起换，
        /// 切到已连接时读起来就是换了一枚图标，而不是指针走到了头。
        func systemImage(current: AppTab, connection: HomeViewModel.HeroState) -> String {
            switch self {
            case .home:
                switch deriveHeroPhase(connection) {
                case .idle: return "gauge.with.dots.needle.bottom.0percent"
                case .connecting: return "gauge.with.dots.needle.bottom.50percent"
                case .connected: return "gauge.with.dots.needle.bottom.100percent"
                }
            case .profiles: return self == current ? "paintpalette.fill" : "paintpalette"
            case .settings: return "gear"
            }
        }
    }

    /// 设置栈的全部子路由。按入口所在的那一页声明，页内顺序即显示顺序。
    enum SettingsRoute: Hashable {
        // 设置首屏
        case rules
        case diagnostics
        case advanced
        // 诊断页
        case usage
        case stats
        case logs
        case config
        // 开发者入口是版本页脚连点，不在任何可见导航里；任务详情是弹层不是路由。
        case dev
        // 开发者页的二级子路由：按返回回开发者页，不落根。
        case refreshRecords
        case engineInfo
    }

    init(actions: AppActions) {
        self.actions = actions
    }

    var body: some View {
        shell
        // 启动失败全局弹层——lastError 由空变非空即弹；非空间迁移（同次失败重复上报）不重复打断。
        .onChange(of: actions.lastError) { previous, current in
            if previous == nil, let current {
                startFailure = StartFailurePresentation(
                    error: current,
                    occurredAt: actions.lastErrorAt,
                    configFingerprint: actions.startConfigFingerprint,
                    source: actions.lastErrorSource
                )
            }
        }
        .sheet(item: $startFailure) { presentation in
            StartFailureSheet(
                error: presentation.error,
                occurredAt: presentation.occurredAt,
                configFingerprint: presentation.configFingerprint,
                source: presentation.source
            )
        }
        // 失败弹层弹出 = error 触感；关闭（回 nil）不发。
        .sensoryFeedback(.error, trigger: startFailure?.id) { _, id in id != nil }
        // 回前台检查新版本：是否真去查由调度判定，这里只报告「回来了」。
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await UpdateCheckTask.run() } }
        }
        // 深链入口：SwiftUI 冷/热启动天然单路径，本层零解析分支，
        // 原串直传唯一解析器 ImportLink.parse。接受 → 携真实载荷；拒绝 → 空载荷落导入页默认态。
        .onOpenURL { url in
            tab = .home
            switch ImportLink.parse(url.absoluteString) {
            case .accepted(let payload):
                pendingImport = payload
            case .rejected:
                pendingImport = ImportPayload(url: "", requestedApply: false)
            }
        }
    }

    // 根外壳：原生 TabView 底部三入口。
    @ViewBuilder
    private var shell: some View {
        TabView(selection: $tab) {
            Tab(
                AppTab.home.title,
                systemImage: tabSymbol(.home),
                value: AppTab.home
            ) {
                homeTab
            }
            Tab(
                AppTab.profiles.title,
                systemImage: tabSymbol(.profiles),
                value: AppTab.profiles
            ) {
                profilesTab
            }
            Tab(
                AppTab.settings.title,
                systemImage: tabSymbol(.settings),
                value: AppTab.settings
            ) {
                settingsTab
            }
        }
    }

    private func tabSymbol(_ entry: AppTab) -> String {
        entry.systemImage(current: tab, connection: actions.heroState)
    }

    /// 内容底部避让：**由导航壳统一负责，页面不自己加**，且安全区只能算一次。
    ///
    /// 原生 `TabView` 已经用 inset 让出了条高，页面消费那份 inset 即可，壳只补剩下的 `12`——
    /// 只在这里加一次，而不是各页各加一次、也不是在已消费的 inset 之上再叠一整条导航栏的高度。
    private func dockClearance(_ content: some View) -> some View {
        content.safeAreaPadding(.bottom, TabDockMetrics.contentGap)
    }

    private var homeTab: some View {
        dockClearance(
            HomeScreen(
                actions: actions,
                path: $homePath,
                pendingImport: $pendingImport
            )
        )
    }

    private var profilesTab: some View {
        dockClearance(ProfilesScreen(actions: actions, path: $profilesPath, openHome: openHome))
    }

    /// 回首页 tab 的出口：切过去并回它的根。导入结果页从别的 tab 走「连接」「立即使用」时用它。
    private func openHome() {
        homePath.removeAll()
        tab = .home
    }

    private var settingsTab: some View {
        dockClearance(settingsStack)
    }

    private var settingsStack: some View {
        NavigationStack(path: $settingsPath) {
            SettingsScreen(actions: actions, open: { settingsPath.append($0) })
                .navigationDestination(for: SettingsRoute.self) { route in
                    SettingsRouteDestination(
                        route: route,
                        actions: actions,
                        push: { settingsPath.append($0) }
                    )
                }
        }
    }
}

// 弹层呈现载荷：每次失败一个身份，sheet(item:) 据此弹出。
private struct StartFailurePresentation: Identifiable {
    let id = UUID()
    let error: EngineError
    let occurredAt: Date?
    let configFingerprint: String?
    /// 与 error 同一拍取下来：弹层活得比那一拍久，而来源是**那次失败**的属性，不是此刻的。
    let source: FailureSource?
}
