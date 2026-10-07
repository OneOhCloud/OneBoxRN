import SwiftUI
import Core

// 配置页：当前配置摘要卡在上，可选择的配置列表在下。
//
// 摘要卡回答「还剩多少、哪天到期」，列表只管选择——点一行即切换，摘要卡跟着换内容、列表顺序不动。
// 自持导航栈承载导入 / 扫码 / 本机用量；数据全部来自 AppActions 的 profiles 快照。
struct ProfilesScreen: View {
    private let actions: AppActions
    @State private var vm: ProfilesViewModel
    @Binding private var path: [Route]
    /// 切到首页 tab 并回它的根：导入结果页「连接」「立即使用」之后，结局在电源砖上看。
    private let openHome: () -> Void
    @State private var showImportSheet = false
    /// 按 id 记：行上的 `Profile` 会随刷新换新值，按整值比对会让确认框在刷新落地时自己收起。
    @State private var pendingDeleteId: String?
    @State private var detailCandidate: ProfileDetailPresentation?
    @State private var deferredRoutes = DeferredRouteQueue<Route>()
    @State private var routeDrainTask: Task<Void, Never>?

    // ImportFlow 路由键（Android 侧以 entryId 区分每次进入）：iOS NavigationStack 每次 push
    // 都是 path 中的独立元素，目的地视图与其 @State VM 天然按次新建，同 payload 重入不复用旧流水线状态。
    enum Route: Hashable {
        case importFlow(payload: ImportPayload)
        case scan
        case usage(profileId: String)
    }

    init(actions: AppActions, path: Binding<[Route]>, openHome: @escaping () -> Void) {
        self.actions = actions
        _vm = State(initialValue: ProfilesViewModel(actions: actions))
        _path = path
        self.openHome = openHome
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .importFlow(let payload):
                        ImportScreen(
                            payload: payload,
                            actions: actions,
                            exits: ImportExits(
                                finish: { path.removeAll() },
                                goHome: {
                                    path.removeAll()
                                    openHome()
                                }
                            )
                        )
                    case .scan:
                        // 扫码识别的 payload（含 requestedApply）原样透传导入流程。
                        ScanScreen { payload in
                            enqueueRoute(.importFlow(payload: payload))
                        }
                    case .usage(let profileId):
                        usageDestination(profileId)
                    }
                }
        }
        .sheet(isPresented: $showImportSheet, onDismiss: scheduleDeferredRouteDrain) {
            ImportSheet(
                onSubmit: { payload in enqueueRoute(.importFlow(payload: payload)) },
                onScan: { enqueueRoute(.scan) },
                onCancel: { showImportSheet = false }
            )
        }
        .sheet(item: $detailCandidate) { presentation in
            ProfileDetailSheet(vm: vm, opened: presentation.profile, productWebsite: actions.aboutLinks.website)
        }
        // 刷新失败 Alert 携错误信息（三类领域错误共用导入的文案映射）。
        .alert(tr("profiles_refresh_failed"), isPresented: refreshFailurePresented) {
            Button(tr("ok"), role: .cancel) { vm.dismissRefreshFailure() }
        } message: {
            if let error = vm.refreshFailure {
                Text(error.alertText)
            }
        }
    }

    /// 详情开着时让给详情自己的那一份：本页被它盖着，这里的提示框弹不出来。
    private var refreshFailurePresented: Binding<Bool> {
        Binding(
            get: { vm.refreshFailure != nil && detailCandidate == nil },
            set: { if !$0 { vm.dismissRefreshFailure() } }
        )
    }

    private func enqueueRoute(_ route: Route) {
        let hadPresentedSheet = showImportSheet
        deferredRoutes.enqueue(route)
        showImportSheet = false
        if !hadPresentedSheet {
            scheduleDeferredRouteDrain()
        }
    }

    private func scheduleDeferredRouteDrain() {
        guard deferredRoutes.hasPendingRoute else { return }
        routeDrainTask?.cancel()
        routeDrainTask = Task { @MainActor in
            await Task.yield()
            drainDeferredRoute()
        }
    }

    private func drainDeferredRoute() {
        guard !showImportSheet else { return }
        guard let route = deferredRoutes.drain(currentRoute: path.last) else { return }
        path.append(route)
    }

    /// 路由的求值与列表的删除不在同一次视图更新里：这里只问「那份配置还在不在」，不断言。
    @ViewBuilder
    private func usageDestination(_ profileId: String) -> some View {
        if let profile = vm.profile(profileId) {
            UsageScreen(actions: actions, profileId: profile.id, profileName: profile.name)
        }
    }

    // —— 版式——

    /// 整页就是一块独立滚动的列表区，**没有页面大标题**——三个根入口一律不带：
    /// dock 上那个标签已经说了这是哪一页。
    private var content: some View {
        scrollingBody
            .screenBackground()
            .contentSwapTransition(vm.refreshState)
            // 刷新结局触感：成功 success / 失败 error。
            .sensoryFeedback(.success, trigger: vm.refreshSuccessCount)
            .sensoryFeedback(.error, trigger: vm.refreshFailureCount)
    }

    @ViewBuilder
    private var scrollingBody: some View {
        if vm.hasProfiles {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let active = vm.activeProfile {
                        ProfileSummaryCard(
                            profile: active,
                            productWebsite: actions.aboutLinks.website,
                            cornerRadius: Theme.Radius.panel,
                            cardBody: .inert
                        )
                            .padding(.bottom, Theme.Spacing.extraLarge)
                    }
                    updateAllButton
                        .padding(.horizontal, Theme.Spacing.large)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.bottom, Theme.Spacing.small)
                    listCard
                }
                .pageInsets(top: Theme.Spacing.large)
            }
            // 下拉与列表上方「更新全部」共用同一刷新动作来源（互斥守卫在 ViewModel）。
            .refreshable { await vm.refreshAll() }
        } else {
            emptyView
        }
    }

    // —— 更新全部 ——

    /// 列表上方只放这一枚、不配标题文字：摘要卡已经说了这是配置，再加一行标题只是多一段字。
    private var updateAllButton: some View {
        let refreshing = vm.refreshState == .refreshing
        return Button { Task { await vm.refreshAll() } } label: {
            HStack(spacing: Theme.Spacing.extraSmall) {
                // 「正在进行」交给系统的不确定型指示符：转圈、停下与「减少动态效果」都由系统收尾。
                if refreshing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                }
                Text(refreshing ? tr("profiles_refreshing") : tr("profiles_update_all"))
                    .font(Theme.TypeScale.statusEmphasis)
            }
            .frame(minHeight: ProfilesLayout.updateAllMinimumHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(UpdateAllButtonStyle())
        .disabled(refreshing)
    }

    // —— 列表卡 ——

    private var listCard: some View {
        LazyVStack(spacing: 0) {
            ForEach(vm.profiles, id: \.id) { profile in
                ProfileRow(
                    profile: profile,
                    isActive: profile.id == vm.activeId,
                    isBusy: vm.updatingIds.contains(profile.id),
                    status: vm.rowStatus[profile.id],
                    handlers: handlers(for: profile)
                )
                .deleteConfirmation(
                    tr("profiles_delete_confirm"),
                    for: profile.id,
                    pending: $pendingDeleteId,
                    onConfirm: { vm.delete(profile.id) }
                )
            }
            ProfileImportRow { showImportSheet = true }
                .accessibilityIdentifier("profiles.import")
        }
        // 卡内嵌着带底色的圆角块（当前项的 `accentContainer`、各行的按下填充），
        // 故取 `panel 18` + 内衬 `6`：`18 − 6 = 12` 正好是行的 `Radius.control`，内外同心。
        .padding(ProfilesLayout.nestedCardInset)
        .cardSurface(cornerRadius: Theme.Radius.panel)
        .colorTransition(vm.activeId)
        // 激活触感：medium；删除激活项的自动提升同样是激活标记移动。
        .sensoryFeedback(.impact(weight: .medium), trigger: vm.activeId)
    }

    private func handlers(for profile: Profile) -> ProfileRowHandlers {
        ProfileRowHandlers(
            activate: { Task { await vm.activate(profile.id) } },
            openUsage: { path.append(.usage(profileId: profile.id)) },
            showDetail: { detailCandidate = ProfileDetailPresentation(profile: profile) },
            refresh: { vm.update(profile.id) },
            delete: { pendingDeleteId = profile.id }
        )
    }

    // —— 空态 ——

    private var emptyView: some View {
        EmptyState(
            systemImage: "square.stack",
            title: tr("profiles_empty_title"),
            caption: tr("profiles_empty_caption"),
            actionLabel: tr("profiles_empty_import"),
            action: { showImportSheet = true },
            actionIdentifier: "profiles.empty.import"
        )
        // 水平边距由**页**供给（组件自身不加水平内衬，空态与同页其它内容左右对齐）。
        .padding(.horizontal, Theme.Spacing.large)
    }
}


/// 配置页的版式账。
enum ProfilesLayout {
    /// 嵌套卡的内衬：家族里唯一同心的一组是 `panel 18` + 内衬 `6` + `control 12`。
    static let nestedCardInset: CGFloat = 6
    /// 「更新全部」的最小高：刷新图标与转圈的指示符不一样高，钉住它，两态切换时列表不上下跳。
    static let updateAllMinimumHeight: CGFloat = 20
}

/// 「更新全部」：强调色文字操作，按下与按钮族同一档透明度。
/// 禁用时退出强调色（换色对不压透明度）。
private struct UpdateAllButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isEnabled ? Theme.accent : Theme.textSecondary)
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

/// `sheet(item:)` 的呈现载荷。**不给 core 的 `Profile` 追加 `Identifiable`**：
/// 那是给别的模块的类型做追溯遵循，会把一个呈现层的需要写进契约类型的公开面。
private struct ProfileDetailPresentation: Identifiable {
    let profile: Profile
    var id: String { profile.id }
}
