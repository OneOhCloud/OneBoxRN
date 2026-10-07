import SwiftUI
import Core

// 首页。整页只回答一件事：**连没连上**。
// 电源砖是唯一主操作、也是这一页的标题（无顶栏、无页面大标题）；其余全部是它的注脚。
//
// 自持 NavigationStack：导入流程 / 扫码在本 tab 栈内推入。
// 延迟测试三触发中的「连接成功上升沿」「回前台」在此观察，触发实现单点在 AppActions。
struct HomeScreen: View {
    private let actions: AppActions
    @State private var vm: HomeViewModel
    @Binding private var path: [Route]
    @State private var showImportSheet = false
    @State private var showFailureSheet = false
    @State private var showNodeSheet = false
    @State private var showProfileSheet = false
    @State private var deferredRoutes = DeferredRouteQueue<Route>()
    @State private var routeDrainTask: Task<Void, Never>?
    // 深链待消费载荷：AppNav.onOpenURL 置位，此处推入 ImportFlow 路由后清空（一次性消费）。
    @Binding private var pendingImport: ImportPayload?
    @Environment(\.scenePhase) private var scenePhase

    enum Route: Hashable {
        case importFlow(payload: ImportPayload)
        case scan
    }

    init(
        actions: AppActions,
        path: Binding<[Route]>,
        pendingImport: Binding<ImportPayload?>
    ) {
        self.actions = actions
        _vm = State(initialValue: HomeViewModel(actions: actions))
        _path = path
        _pendingImport = pendingImport
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .importFlow(let payload):
                        // 本来就在首页 tab：回首页与收尾是同一件事。
                        ImportScreen(
                            payload: payload,
                            actions: actions,
                            exits: ImportExits(finish: { path.removeAll() }, goHome: { path.removeAll() })
                        )
                    case .scan:
                        ScanScreen { payload in
                            enqueueRoute(.importFlow(payload: payload))
                        }
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
        .sheet(isPresented: $showFailureSheet) {
            if let error = vm.lastError {
                StartFailureSheet(
                    error: error,
                    occurredAt: vm.lastErrorAt,
                    configFingerprint: vm.startConfigFingerprint,
                    source: vm.lastErrorSource
                )
            }
        }
        .sheet(isPresented: $showNodeSheet) { nodeSheet }
        .sheet(isPresented: $showProfileSheet) { profileSheet }
        // 深链消费：置位即推入导入页；onAppear 兜底冷启动置位早于观察者挂载的时序。
        .onAppear(perform: consumePendingImport)
        .onChange(of: pendingImport) { _, _ in consumePendingImport() }
        // 延迟测试三触发：连接成功上升沿 / 激活 profile 变化 / 回前台。
        .onChange(of: vm.connected) { previous, current in
            if !previous && current { vm.connectionEstablished() }
        }
        .onChange(of: vm.activeProfileId) { _, _ in
            vm.retestIfConnected()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { vm.retestIfConnected() }
        }
    }

    // 深链载荷唯一消费点：先清空再推入，一次性语义保证场景重建不重放；
    // 弹层同步收起，保证导入页（含拒绝分支的默认态）对用户可见。
    private func consumePendingImport() {
        guard let payload = pendingImport else { return }
        pendingImport = nil
        enqueueRoute(.importFlow(payload: payload))
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

    // —— 版式 ——

    // GeometryReader 只为拿视口高度。**`minHeight` 是余量分配能工作的前提**：`ScrollView`
    // 给内容的是**无界高度**，不把最小高钉在视口上，列高就等于内容自然高 ⇒ **没有自由空间可分，
    // 各条缝全部取下限，版式静默挤成顶对齐**。
    // 失效形态是编得过、无警告、区域直接紧贴，所以这一句和 `GapColumnLayout` 是一件事，不能分开动。
    // 内容更高时仍照常滚动，不用 containerRelativeFrame（那是定高，超出会被裁）。
    private var content: some View {
        GeometryReader { viewport in
            // 列高 = 视口减去壳给的那一档与顶内衬，即 `minHeight` 那一列扣掉顶内衬后的高。
            let hero = HeroGeometry(tileSide: HomeLayout.heroTiers.tileSide(
                forColumnHeight: viewport.size.height - TabDockMetrics.contentGap - HomeLayout.topInset
            ))
            ScrollView {
                // 两项只取自身高度，其余全部归三条缝，怎么分见 `HomeLayout.gaps` 与 `groupDrop`。
                // 有无配置是同一列、同一余量规则：导入之后砖原地换回电源符号，不跳。
                GapColumnLayout(gaps: HomeLayout.gaps, drop: HomeLayout.groupDrop) {
                    stage(hero)
                    groupSlot
                }
                .frame(maxWidth: .infinity)
                .pageInsets(top: HomeLayout.topInset, horizontal: HomeLayout.horizontalMargin)
                // **减掉的这一档是壳给的呼吸量，本页不能连它一起占。**
                // `AppNav.dockClearance` 用 `safeAreaPadding(.bottom, 12)` 给内容与 dock 之间
                // 留一档；对普通滚动页那是内容内衬，照常生效。而本页 `minHeight` 按**视口整高**
                // 顶出一屏内容 ⇒ 不减就把那一档一起占了，内容贴到 dock 顶沿。
                // （`viewport.safeAreaInsets.bottom` 是 dock 条高那一档，不是这一档。）
                .frame(minHeight: viewport.size.height - TabDockMetrics.contentGap)
            }
        }
        .screenBackground(vm.pageTint)
        .toolbar(.hidden, for: .navigationBar)
        .contentSwapTransition(vm.heroPhase)
    }

    /// 舞台：电源砖 →`16`→ 状态行。回答「连没连上」。
    private func stage(_ hero: HeroGeometry) -> some View {
        VStack(spacing: 0) {
            heroTile(hero)
                .padding(.bottom, HomeLayout.heroToStatus)
            statusRow
        }
    }

    /// 无配置时同一块砖换成导入入口，而不是一块禁用的电源砖：禁用的砖仍进读屏，
    /// 看起来是一个点不动的启动按钮。
    @ViewBuilder
    private func heroTile(_ hero: HeroGeometry) -> some View {
        if vm.hasConfig {
            ConnectHero(phase: vm.heroPhase, geometry: hero, action: vm.tapHero)
                // loading 期间禁用。
                .disabled(vm.loading)
                .accessibilityIdentifier("home.hero")
        } else {
            ConnectHero(phase: .idle, geometry: hero, glyph: .importConfig) { showImportSheet = true }
                .accessibilityIdentifier("home.empty.import")
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        if vm.hasConfig {
            HomeStatusRow(phase: vm.statusPhase, text: vm.statusText)
        } else {
            // 砖自己的读屏标签已经是这一句，这一行只给眼睛看。
            Text(tr("home_empty_import"))
                .font(HomeLayout.statusType)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
        }
    }

    private var groupSlot: some View {
        HomeGroupSlot(
            current: vm.group,
            profileCard: profileCard,
            session: vm.sessionReadings,
            actions: HomeGroupSlot.Actions(
                selectNode: { showNodeSheet = true },
                showFailure: { showFailureSheet = true }
            )
        )
    }

    /// 没有当前配置就没有这张卡：那时也没有配置可说，组位高由另外两张撑住。
    private var profileCard: ProfileSummaryCard? {
        vm.activeProfile.map { profile in
            ProfileSummaryCard(
                profile: profile,
                productWebsite: actions.aboutLinks.website,
                cornerRadius: HomeCardMetrics.radius,
                cardBody: canSwitchProfile(profileCount: vm.profiles.count)
                    ? .switchesProfile { showProfileSheet = true }
                    : .inert
            )
        }
    }

    // —— 选择弹层 ——

    /// 换配置：与配置页的列表同一组配置、同一串用量，选中即切（经 `switchProfile(to:)`）。
    private var profileSheet: some View {
        SelectionSheet(
            title: tr("tab_profiles"),
            count: vm.profiles.count,
            options: vm.profiles.map(\.id),
            selection: vm.activeProfile?.id,
            onSelect: { id in Task { await vm.switchProfile(id) } },
            row: { profileRowLabel($0) }
        )
    }

    /// 弹层开着时配置被删掉，那一行就不画：选项与标签读的是同一份快照，下一拍就会一致。
    @ViewBuilder
    private func profileRowLabel(_ id: String) -> some View {
        if let profile = vm.profiles.first(where: { $0.id == id }) {
            ProfileOptionLabel(profile: profile, ground: id == vm.activeProfile?.id ? .accentContainer : .plain)
        }
    }

    private var nodeSheet: some View {
        SelectionSheet(
            title: tr("nodes_title"),
            count: vm.selection.nodes.count,
            options: vm.selection.nodes.map(\.tag),
            selection: vm.selectedNode.isEmpty ? nil : vm.selectedNode,
            onSelect: vm.selectNode,
            row: { nodeRowLabel($0) }
        )
    }

    private func nodeRowLabel(_ tag: String) -> some View {
        let lines = NodeNameLines.of(tag: tag, autoResolved: vm.selection.autoResolved)
        let onAccentContainer = tag == vm.selectedNode
        return HStack(spacing: Theme.Spacing.medium) {
            // 弹层这一列回答「选哪一种」：自动那一行先说「自动选择」，此刻的出口是它下面的注脚。
            VStack(alignment: .leading, spacing: 0) {
                Text(lines.autoCaption ?? lines.name)
                    .font(Theme.TypeScale.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                if lines.autoCaption != nil {
                    Text(lines.name)
                        .font(Theme.TypeScale.subtitle)
                        .foregroundStyle(Theme.secondaryText(on: onAccentContainer ? .accentContainer : .plain))
                }
            }
            .lineLimit(1)
            // 与会话卡同一条：保住开头的地区与结尾的编号，同地区的几个节点才分得清。
            .truncationMode(.middle)
            Spacer(minLength: 0)
            NodeLatencyReadout(reading: vm.latency(of: tag), onAccentContainer: onAccentContainer)
        }
    }
}

/// 组位：配置卡 / 会话卡 / 失败卡三张叠放，谁在场由 `deriveHomeGroup` 决定；连接中一张都不在。
///
/// **叠放而不是 if/else 换视图**：三张始终参与求高，组位高恒定；未轮到的只是看不见、点不到、读屏跳过。
/// 组位一变，余量就重分，电源砖跟着上下跳。
///
/// **顶对齐**：默认字号下三张同高，对齐方式看不出来；无障碍字号下配置卡改竖排、比另两张高，
/// 组位仍取最高的那张（电源砖不动），矮的那张贴顶，而不是在高组位里居中下沉。
struct HomeGroupSlot: View {
    struct Actions {
        let selectNode: () -> Void
        let showFailure: () -> Void
    }

    let current: HomeGroup?
    /// 没有当前配置时为 nil：无配置态组位本就空着。
    let profileCard: ProfileSummaryCard?
    let session: SessionCard.Readings
    let actions: Actions

    var body: some View {
        ZStack(alignment: .top) {
            if let profileCard {
                profileCard
                    .accessibilityIdentifier("home.profile")
                    .keepingSpace(visibility(of: .profile))
            }
            SessionCard(readings: session, onSelectNode: actions.selectNode)
                .keepingSpace(visibility(of: .session))
            HomeEntryCard(content: .failureDetails, action: actions.showFailure)
                .accessibilityIdentifier("home.failure")
                .keepingSpace(visibility(of: .failureDetails))
        }
        .frame(maxWidth: .infinity)
    }

    private func visibility(of group: HomeGroup) -> SlotVisibility {
        group == current ? .shown : .hiddenKeepingSpace
    }
}

extension HomeEntryCard.Content {
    static var failureDetails: Self {
        Self(
            systemImage: "exclamationmark",
            tone: Theme.error,
            title: tr("home_failure_title"),
            titleColor: Theme.error.fg,
            note: tr("home_failure_hint")
        )
    }
}

/// 首页的垂直节奏。写在一处，避免间距散成魔法数。
enum HomeLayout {
    /// 首页是**唯一**取 `20` 的页面（对位 OneBox 的 `px-5`）；
    /// 配置页与设置页仍是 `16`。不要吸附回 `16` 或 `24`。
    static let horizontalMargin: CGFloat = 20
    static let topInset: CGFloat = 20
    static let heroToStatus = Theme.Spacing.large
    /// 舞台与组位之间的定距，各机型同一个值：组内距离不随屏高变，舞台与卡的关系在各机型上才一致。
    static let stageToGroup: CGFloat = 128
    /// 组外余量按 `2 : 3` 分完之后，整组再下移的定量，从底缝扣给顶缝。
    /// `2 : 3` 让整组重心偏高，这一段把视觉重心放低；底缝扣到下限 `16` 为止，不够扣就少扣。
    static let groupDrop: CGFloat = 24
    /// 三条缝：顶缝（顶内衬之下）· 舞台与组位之间 · 组位与 dock 之间。
    ///
    /// 舞台与组位是一组，组内距离钉在 `stageToGroup`，不随屏高、也不随电源砖档位伸缩；
    /// 屏高带来的余量只进组外，顶 : 底 = `2 : 3`，之后再按 `groupDrop` 整组下移。
    /// 底缝下限 `16`：矮屏上下移也扣不穿它，卡不贴 dock。
    static let gaps = [
        GapRule(minimum: 0, weight: 2),
        GapRule(minimum: stageToGroup, weight: 0),
        GapRule(minimum: Theme.Spacing.large, weight: 3),
    ]
    /// 状态行：手机上电源砖放大，状态行随之升档。
    static let statusType = Theme.TypeScale.heroStatus
    /// 电源砖按列高分档：手机上 `160` 撑不起舞台，基础档放大到 `184`；列高够的屏（Pro Max / Plus）
    /// 上 `184` 仍在大片留白里显得小，再升一档。按列高而不是机型判：分档要回答的是「这一列有多高」。
    static let heroTiers = HeroTiers(
        base: 184,
        upgrades: [HeroTiers.Upgrade(minimumColumnHeight: 740, tileSide: 208)]
    )
}

/// 电源砖分档：列高够不到任何升档门槛时取 `base`，否则取够得着的最高一档。
struct HeroTiers: Equatable {
    struct Upgrade: Equatable {
        let minimumColumnHeight: CGFloat
        let tileSide: CGFloat
    }

    let base: CGFloat
    let upgrades: [Upgrade]

    init(base: CGFloat, upgrades: [Upgrade]) {
        precondition(
            zip(upgrades, upgrades.dropFirst()).allSatisfy { $0.minimumColumnHeight < $1.minimumColumnHeight },
            "升档表必须按列高升序"
        )
        self.base = base
        self.upgrades = upgrades
    }

    /// 任何列高都有一档砖：首次布局时视口还没量到，列高是负的。
    func tileSide(forColumnHeight height: CGFloat) -> CGFloat {
        upgrades.last { height >= $0.minimumColumnHeight }?.tileSide ?? base
    }
}

/// 状态行：状态点 + 状态文案（字档见 `HomeLayout.statusType`）。连接中由状态点的缓慢脉冲表达，不由电源砖的运动表达。
private struct HomeStatusRow: View {
    let phase: HomeViewModel.StatusPhase
    let text: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: Theme.Spacing.small) {
            Circle()
                .fill(dotColor)
                .frame(width: HomeStatusMetrics.dotSide, height: HomeStatusMetrics.dotSide)
                // 过渡相位下状态点的缓慢脉冲；同一拍还有缩放，不是唯一通道。
                .opacity(pulsing ? HomeStatusMetrics.pulseOpacity : 1)
                .scaleEffect(pulsing ? HomeStatusMetrics.pulseScale : 1)
                // 脉冲由**相位**驱动，不由一次性的 onAppear 驱动：`repeatForever` 只在它被启动的
                // 那一次事务里成立，而 `animation(_:value:)` 只在 value 变化时重挂——把开关挂在
                // 自身状态上，第二次进过渡态就再也动不起来了。
                .onChange(of: phase, initial: true) { _, next in
                    restartPulse(for: next)
                }
            Text(text)
                .font(HomeLayout.statusType)
                .foregroundStyle(textColor)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }

    /// 只有过渡态脉冲：`1.8s` 一个来回（半程 `0.9s` 自动反向），`cubic-bezier(0.45, 0, 0.55, 1)`，
    /// 无限。减少动态效果时不脉冲——那是缩放，属被禁的那一类。
    ///
    /// **入参是相位而不是一个布尔**：`on` 原本就是 `phase == .transitioning` 的投影，
    /// 传布尔等于把判据抄到调用点，而这里正是它唯一该被决定的地方。
    private func restartPulse(for phase: HomeViewModel.StatusPhase) {
        pulsing = false
        guard phase == .transitioning, !reduceMotion else { return }
        withAnimation(
            .timingCurve(0.45, 0, 0.55, 1, duration: HomeStatusMetrics.pulseHalfCycle)
                .repeatForever(autoreverses: true)
        ) {
            pulsing = true
        }
    }

    private var dotColor: Color {
        switch phase {
        case .idle: return Theme.textSecondary
        case .transitioning, .connected: return Theme.accent
        case .failed: return Theme.error.fg
        }
    }

    private var textColor: Color {
        switch phase {
        case .idle: return Theme.textSecondary
        case .transitioning, .connected: return Theme.textPrimary
        case .failed: return Theme.error.fg
        }
    }
}

enum HomeStatusMetrics {
    /// 状态点随文案字档：手机上文案是 `17`，`5` 的点小到读不出颜色。
    static let dotSide: CGFloat = 8
    static let pulseOpacity: Double = 0.4
    static let pulseScale: CGFloat = 0.85
    /// 半个来回；一个完整脉冲周期是它的两倍（`1.8s`）。
    static let pulseHalfCycle: Double = 0.9
}

/// 节点行的延迟区：**定宽**，数字变化不得让行内元素左右移动。
/// 三态：数值（档位色）/ 测速中（等待指示）/ 无数据（「—」）。
private struct NodeLatencyReadout: View {
    let reading: LatencyReading
    /// 这一行此刻是不是坐在 `accentContainer` 上（选中行）。
    ///
    /// **判据是「底是什么」，不是「选没选中」** —— 与 `InputField.secondarySurface` 同一条纪律：
    /// 两者分开写就会漂（容器换了色而字没跟着升档）。此处两者同源，故直接用选中态推出。
    let onAccentContainer: Bool

    var body: some View {
        readout
            .frame(width: 56, alignment: .trailing)
    }

    @ViewBuilder
    private var readout: some View {
        switch reading {
        case .measured(let delayMs, let tier):
            Text(tr("nodes_delay", String(delayMs)))
                .font(Theme.TypeScale.meta.monospacedDigit())
                // **选中行回 `textPrimary`**：那一行的底是 `accentContainer`，语义前景压它不达标。
                // 毫秒数**就是文字本身**，档位色在这里是**冗余编码**（颜色不是唯一手段）。
                // 未选中行不坐在 `accentContainer` 上，档位色照旧。
                .foregroundStyle(onAccentContainer ? Theme.textPrimary : tier.tone.fg)
        case .testing:
            ProgressView()
                .controlSize(.small)
        case .unavailable:
            Text(verbatim: "—")
                .font(Theme.TypeScale.meta.monospacedDigit())
                // 占位符**随底升档**：`textSecondary` 压选中底不达标。
                .foregroundStyle(Theme.secondaryText(on: onAccentContainer ? .accentContainer : .plain))
        }
    }
}
