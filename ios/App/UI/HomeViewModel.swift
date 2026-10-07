import Foundation
import Observation
import Core

// 主页真实驱动：注入 AppActions，暴露只读派生状态。
// 连接真相以 OS VPN 状态为唯一权威；EngineStatus 仅细化「连接中/断开中」过渡态；
// lastError 非空且未连接 → 失败态持续可见，直到下次成功启动。
@MainActor
@Observable
final class HomeViewModel {
    enum HeroState {
        case disconnected
        case connecting
        case startFailed
        case connected
        case disconnecting
    }

    /// 状态行的四种呈现。
    /// 「连接中」与「断开中 / 切换中」在这里合成同一相位——它们的点、色与脉冲完全一致，
    /// 只有文案不同，故文案单独给（`statusText`），呈现层不必再判一次。
    enum StatusPhase {
        case idle
        case transitioning
        case connected
        case failed
    }

    private let actions: AppActions

    init(actions: AppActions) {
        self.actions = actions
    }

    var heroState: HeroState { actions.heroState }

    var heroPhase: ConnectHero.Phase { deriveHeroPhase(heroState) }

    var pageTint: Theme.PageTint { derivePageTint(heroState) }

    var statusPhase: StatusPhase { deriveStatusPhase(heroState) }

    var statusText: String { tr(statusTextKey(heroState)) }

    /// loading = 本地操作进行中 ∨ 引擎 STARTING ∨ STOPPING；期间英雄键禁用。
    var loading: Bool { heroState == .connecting || heroState == .disconnecting }

    var connected: Bool { actions.connected }
    var traffic: Traffic { actions.traffic }

    /// 首页网速与运行统计页同源同拍，断流判据也必须同一个——否则同一时刻两页
    /// 一个显数字一个显占位，成了两份不一致的运行时指标来源。
    var downloadRate: String { reading(TrafficFormat.rate(traffic.down)) }
    var uploadRate: String { reading(TrafficFormat.rate(traffic.up)) }

    /// 本次用量：引擎报的上下行累计之和，与速率同一个断流判据。
    var sessionUsage: String { reading(TrafficFormat.bytes(traffic.upTotal + traffic.downTotal)) }

    private func reading(_ formatted: String) -> String {
        actions.trafficStale ? StatsViewModel.placeholder : formatted
    }

    /// 已连接时组位里那张会话卡的全部读数。
    var sessionReadings: SessionCard.Readings {
        SessionCard.Readings(
            node: selectedNodeLines,
            latency: latency(of: selectedNode),
            downloadRate: downloadRate,
            uploadRate: uploadRate,
            usage: sessionUsage,
            startedAt: actions.sessionStartedAt
        )
    }

    var lastError: EngineError? { actions.lastError }
    var lastErrorAt: Date? { actions.lastErrorAt }
    var lastErrorSource: FailureSource? { actions.lastErrorSource }
    var startConfigFingerprint: String? { actions.startConfigFingerprint }

    /// 有配置判定 = 激活 profile 的配置内容非空。
    var hasConfig: Bool { !actions.activeConfigContent.isEmpty }

    /// 延迟测试三触发之「激活 profile 变化」的观察源。
    var activeProfileId: String? { actions.activeProfile?.id }

    /// 无配置时砖本身就是导入入口，组位里没有配置可说。
    var group: HomeGroup? { hasConfig ? deriveHomeGroup(heroState, selection: selection) : nil }

    // —— 配置卡与配置切换 ——

    var profiles: [Profile] { actions.profiles }
    var activeProfile: Profile? { actions.activeProfile }

    /// 配置卡点开的切换弹层里选中一项；已是当前项的守卫在 `switchProfile(to:)`。
    /// 启动失败的诊断由动作层落 lastError、经失败卡呈现，这里不二次接。
    func switchProfile(_ id: String) async {
        try? await actions.switchProfile(to: id)
    }

    // —— 节点选择器（出口选择组的平铺投影，自动行附自动组实际节点）——

    /// 出口选择组的平铺投影（组名不进呈现层）。
    var selection: NodeSelection { NodeSelection.from(actions.groups) }

    /// 乐观选中：点按即显示，下一次分组推送到达即改用引擎真相（判定在 core NodeSelection）。
    @ObservationIgnored private var optimisticNode: NodeSelection.Optimistic?

    var selectedNode: String {
        NodeSelection.selectedForDisplay(
            engineSelected: selection.selected,
            optimistic: optimisticNode,
            groupsGeneration: actions.groupsGeneration
        )
    }

    /// 会话卡上的节点名：还没有选中值时说「节点」，不留一段空白。
    var selectedNodeLines: NodeNameLines {
        selectedNode.isEmpty
            ? NodeNameLines(name: tr("nodes_title"), autoCaption: nil)
            : NodeNameLines.of(tag: selectedNode, autoResolved: selection.autoResolved)
    }

    /// 测速窗口由 AppActions 开合；窗口内没有数值的节点读作「测速中」。
    func latency(of tag: String) -> LatencyReading {
        LatencyReading(
            delayMs: selection.nodes.first { $0.tag == tag }?.delayMs ?? 0,
            testing: actions.latencyTesting
        )
    }

    /// 节点切换经 Monitor 契约（失败告警待契约补失败通道，见 selectNode 端口现状）。
    func selectNode(_ tag: String) {
        optimisticNode = NodeSelection.Optimistic(tag: tag, generation: actions.groupsGeneration)
        actions.selectNode(tag: tag)
    }

    // —— 交互 ——

    func tapHero() {
        if loading { return } // 门控：至多一条启停操作在途
        actions.toggle()
    }

    /// 延迟测试三触发之「连接成功」（上升沿，视图层观察 OS 连接真相变化后转发）。
    func connectionEstablished() {
        actions.triggerLatencyTests()
    }

    /// 延迟测试三触发之「激活 profile 变化」/「回前台」：仅已连接时开测试窗口。
    func retestIfConnected() {
        if connected { actions.triggerLatencyTests() }
    }
}

extension AppActions {
    /// 首页与其余读连接态的入口读同一组输入：接线只在这一处，各处读到的连接态不会各自漂移。
    var heroState: HomeViewModel.HeroState {
        deriveHeroState(
            connected: connected,
            status: status,
            hasError: lastError != nil,
            startPending: startInFlight,
            stopPending: stopInFlight
        )
    }
}

// heroState 推导纯函数（单测锁定；与 Android `deriveHeroState` 同名同形同优先级）。
//
// **断开中排在已连接之前**：停止在途时 OS 仍报 connected，若先判 connected，断开中
// 就只在引擎恰好报 STOPPING 的窗口里可见、OS 一翻转又直接跳到未连接——那一步几乎不可达。
func deriveHeroState(
    connected: Bool,
    status: EngineStatus,
    hasError: Bool,
    startPending: Bool,
    stopPending: Bool
) -> HomeViewModel.HeroState {
    if stopPending || status == .stopping { return .disconnecting }
    if connected { return .connected }
    if startPending || status == .starting { return .connecting }
    if hasError { return .startFailed }
    return .disconnected
}

/// 电源砖只认三个相位：它的填充与图标色只有三种取值。
/// **失败态不改变砖的外观**——失败由状态行与失败卡承担，砖保持「现在没连上」的那一种。
func deriveHeroPhase(_ state: HomeViewModel.HeroState) -> ConnectHero.Phase {
    switch state {
    case .connected: return .connected
    case .connecting, .disconnecting: return .connecting
    case .disconnected, .startFailed: return .idle
    }
}

/// 电源砖此刻按下去会做什么：隧道在跑或正要跑 → 断开，其余 → 连接。
/// 导入结论页的主按钮读它（Core `ImportConclusion.of`），与砖同一语义，不另判一次连没连着。
func deriveHeroAction(_ state: HomeViewModel.HeroState) -> HeroAction {
    switch state {
    case .connected, .connecting: return .disconnect
    case .disconnected, .startFailed, .disconnecting: return .connect
    }
}

/// 页顶晕染跟着电源砖走：蓝色只属于「已连接」。连接中的砖还是未连接的样子，页面不先一步变蓝。
func derivePageTint(_ state: HomeViewModel.HeroState) -> Theme.PageTint {
    deriveHeroPhase(state) == .connected ? .accent : .neutral
}

/// 状态行的相位：「连接中」与「断开中 / 切换中」的点、色与脉冲完全一致，
/// 只有文案不同，故合成同一相位，文案单独给。
func deriveStatusPhase(_ state: HomeViewModel.HeroState) -> HomeViewModel.StatusPhase {
    switch state {
    case .connected: return .connected
    case .connecting, .disconnecting: return .transitioning
    case .startFailed: return .failed
    case .disconnected: return .idle
    }
}

/// 状态行文案的键。
/// **断开中说的是「正在切换…」**：断开中与切换模式后的自动重连对用户是同一件事——
/// 一次正在进行的切换；分成两句只会让用户去猜两者有什么不同。
func statusTextKey(_ state: HomeViewModel.HeroState) -> String {
    switch state {
    case .disconnected: return "home_disconnected"
    case .connecting: return "home_connecting"
    case .connected: return "home_connected"
    case .disconnecting: return "home_switching"
    case .startFailed: return "home_start_failed"
    }
}

/// 首页组位此刻放哪一张卡；`nil` = 这一格空着（位置照留，见 `HomeGroupSlot`）。
enum HomeGroup {
    /// 未连接：当前配置卡（名称、到期、流量）；两份以上配置时点开换配置。
    case profile
    /// 已连接：节点、网速、本次时长与用量；节点行点开换节点。
    case session
    /// 启动失败：点开看诊断。
    case failureDetails
}

/// 组位的归属。连接中 / 切换中没有哪一张成立；已连接而出口组还没有成员时，节点行点开的弹层里不会有东西。
func deriveHomeGroup(_ state: HomeViewModel.HeroState, selection: NodeSelection) -> HomeGroup? {
    switch state {
    case .disconnected: return .profile
    case .connecting, .disconnecting: return nil
    case .connected: return selection.nodes.isEmpty ? nil : .session
    case .startFailed: return .failureDetails
    }
}

/// 首页配置卡能不能点开切换：只有一份配置时无从切换，卡身不可点、不画「›」。
func canSwitchProfile(profileCount: Int) -> Bool {
    profileCount >= 2
}

/// 本次时长的读数：不在会话里是占位符。墙钟可能被往回拨，起点落在「现在」之后按 0 算。
/// 满一天后天数单说、钟面只留到分：秒位在那个量级上已没有读的意义。
func sessionDurationText(startedAt: Date?, now: Date) -> String {
    guard let startedAt else { return StatsViewModel.placeholder }
    let seconds = max(0, Int64(now.timeIntervalSince(startedAt)))
    let parts = DurationFormat.parts(seconds: seconds)
    guard parts.days > 0 else { return DurationFormat.clock(seconds: seconds) }
    return tr("home_session_days", String(parts.days), DurationFormat.hoursMinutes(parts))
}

/// 一个节点此刻的延迟读数。会话卡圆位与节点弹层行共用这一次判定。
enum LatencyReading: Equatable {
    /// 有数值：数字始终在，档位只是冗余的颜色编码。
    case measured(delayMs: Int, tier: NodeLatency.Tier)
    /// 测速窗口开着、还没有数值。
    case testing
    /// 无数据或超时。
    case unavailable

    /// **数值优先于测速中**：窗口开着时旧数值仍然有效，换成转圈等于把已知的读数藏起来。
    init(delayMs: Int, testing: Bool) {
        let tier = NodeLatency.tier(delayMs: delayMs)
        if tier != .none {
            self = .measured(delayMs: delayMs, tier: tier)
        } else {
            self = testing ? .testing : .unavailable
        }
    }

    /// 没有数值的两态都落 `none` 档：颜色只随数值走。
    var tier: NodeLatency.Tier {
        if case .measured(_, let tier) = self { return tier }
        return .none
    }
}
