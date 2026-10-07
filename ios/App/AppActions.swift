import Foundation
@preconcurrency import NetworkExtension
import Observation
import Core

/// iOS 首装授权前置只覆盖最终会自动应用的受信载荷，未受信载荷仍降级为手动导入。
func shouldPrepareTunnelAuthorization(_ payload: ImportPayload, trusted: Set<String>) -> Bool {
    payload.requestedApply
        && DomainVerify.verify(UrlInfo.hostname(payload.url), allowedSha256: trusted)
}

// 应用动作的单一可复用层（镜像 Android AppActions.kt）：UI 与后续开发期 harness 共用同一套底层动作。
// 同时是 profile 与规则全部变更的唯一漏斗：每条变更命令落地后重发对应快照。
// 观察面收拢自 controller（连接真相）与 client（引擎阶段/流量/分组/lastError）；
// 命令面转发到 controller / 导入与刷新流水线（core ImportFlow / ConfigRefresh）/ Monitor 与纯探针函数。
@MainActor
@Observable
final class AppActions: ImportActions {
    @ObservationIgnored private let controller: TunnelController
    @ObservationIgnored private let client: TunnelClient
    @ObservationIgnored private let monitor: Monitor
    @ObservationIgnored private let profileStore: ProfileStore
    @ObservationIgnored private let ruleStore: RuleStore
    @ObservationIgnored private let debugFallbackConfig: String
    // 加速代理 base URL（构建期注入，可为空串 = 未配置）。
    @ObservationIgnored private let acceleratorBase: String
    @ObservationIgnored private let refreshRecords: RefreshRecordStore
    // 后台自动更新开关变更钩子：注册/注销周期任务；调度器是平台件，故由装配处接。
    @ObservationIgnored private let onBackgroundRefreshChanged: (Bool) -> Void

    /// 两源日志唯一缓冲：本层喂 APP 源，UI 经此读取呈现。
    let logStore: LogStore

    /// 启动期引擎日志的回读：隧道进程把那 20 秒里引擎说的话落在 App Group，
    /// 本件把它喂进 `ENGINE` 段。没有它，启动失败时日志页恰恰是空的。
    @ObservationIgnored private lazy var startupLogIngest = StartupLogIngest(logStore: logStore)

    /// 关于外链：装配期注入，设置页消费。
    let aboutLinks: AboutLinks

    /// 新版本检查：装配期注入，设置页与根导航消费。
    let updates: UpdateChecker

    /// 显式触发后 delay=0 视为「测试中」的窗口时长（沿袭 RN TESTING_WINDOW_MS）。
    private static let latencyTestWindow: Duration = .seconds(12)

    /// 合并输入的日志级别偏好：不设级别调节 UI，恒 info。
    private static let mergeLogLevel = "info"
    private static var templateCache: [RoutingMode: String] = [:]

    /// 最近一次探测胜者（nil = 未探测过或零响应）；合并装配与设置页 DNS 行消费，
    /// 连接期间不变——已连接时展示值恒等于启动配置所用值。
    private(set) var directDns: String?

    @ObservationIgnored private var dnsFlight: Task<String?, Never>?

    private(set) var profiles: [Profile]
    private(set) var activeProfile: Profile?

    /// 唯一常驻的配置内容（激活项）；非激活内容不进内存，也就无投影可发。
    private(set) var activeConfigContent: String
    private(set) var routingMode: RoutingMode
    private(set) var mergeRevision = 0

    /// 区域选择，纯占位设置——只持久化，不参与合并装配也不触发重启。
    private(set) var region: Region

    /// 网络包含范围（iOS 专属，持久化唯一读写处在 `NetworkInclusionStore`）。
    /// 取值不进配置合并——它摊成系统 VPN protocol 的属性，装配在 TunnelController。
    private(set) var networkInclusion: NetworkInclusion
    @ObservationIgnored private let networkInclusionStore: NetworkInclusionStore

    /// 规则快照（规范序在 RuleStore 维护）：变更命令落地后经 publishRules 重发。
    private(set) var rules: [Rule]

    /// 本地启动操作在途（与引擎 STARTING/STOPPING 共同构成 loading 门控；至多一条在途）。
    private(set) var startInFlight = false

    /// 本地停止操作在途：没有它，点断开到引擎报 `STOPPING` 之间英雄键既不禁用、也不显示断开中。
    private(set) var stopInFlight = false

    /// 延迟测试窗口开启中（窗口内 delay=0 显示加载指示）。
    private(set) var latencyTesting = false
    @ObservationIgnored private var latencyWindowGeneration = 0

    // 启动失败诊断双通道（镜像 Android combine(controller.lastError, client.lastError)）：
    // 本地通道承载合并失败 / 启动超时（iOS 无 OS 广播通道），Monitor 通道承载引擎持久化诊断；
    // 各自在下次成功启动清空。
    /// 本地登记那一份：**诊断 / 时刻 / 来源存成一件**（`FailureAttribution`）。
    /// 分成三个字段存，就会有一天只写两个——而那正是这个类型存在的理由。
    private var localAttribution: FailureAttribution = .none

    init(
        controller: TunnelController,
        client: TunnelClient,
        monitor: Monitor,
        profileStore: ProfileStore,
        ruleStore: RuleStore,
        networkInclusionStore: NetworkInclusionStore,
        logStore: LogStore,
        aboutLinks: AboutLinks,
        updates: UpdateChecker,
        debugFallbackConfig: String,
        acceleratorBase: String,
        refreshRecords: RefreshRecordStore,
        onBackgroundRefreshChanged: @escaping (Bool) -> Void = { _ in }
    ) {
        self.controller = controller
        self.client = client
        self.monitor = monitor
        self.profileStore = profileStore
        self.ruleStore = ruleStore
        self.networkInclusionStore = networkInclusionStore
        self.logStore = logStore
        self.aboutLinks = aboutLinks
        self.updates = updates
        self.debugFallbackConfig = debugFallbackConfig
        self.acceleratorBase = acceleratorBase
        self.refreshRecords = refreshRecords
        self.onBackgroundRefreshChanged = onBackgroundRefreshChanged
        profiles = profileStore.getAll()
        activeProfile = profileStore.getActive()
        activeConfigContent = profileStore.activeContent()
        routingMode = RoutingModePreference.load()
        region = RegionPreference.load()
        networkInclusion = networkInclusionStore.get()
        rules = ruleStore.getAll()
        // 回收时机一：App 启动。另一处在断开完成后（见 disconnect）。
        reclaimUsageRecords()
        // 没有等待者的失败（按需连接、系统设置里的开关拉起的）由会话自己发布，否则 App 开着也看不到。
        controller.installStartFailurePublisher { [client] in client.refreshLastError() }
    }

    /// 读一个配置的本机账本（账本与「有无记录」同一次读出）；约 68 KB，不占主线程。
    func usageRecord(profileId: String) async -> UsageRecordSnapshot {
        let reader = usageReader
        return await Task.detached(priority: .userInitiated) { reader.load(profileId: profileId) }.value
    }

    /// 只在隧道**确已停止**时回收——运行中的采样器是那些文件的唯一写者。
    /// 判据取「OS 未连接 **且** 引擎阶段为 STOPPED」：只看 connected 会把启动中与停止中
    /// 也算成「没在跑」，那两个阶段采样器仍可能在写。
    private func reclaimUsageRecords() {
        guard !connected, client.status == .stopped else { return }
        let reader = usageReader
        let ids = Set(profileStore.getAll().map(\.id))
        Task.detached(priority: .background) { reader.reclaim(liveProfileIds: ids) }
    }

    // TunnelControl 端口：启动期在此装配合并配置（单一实现）。
    // lazy 以便闭包捕获 self 的合并装配单点。
    /// 配置变更的串行链（见 `applyConfigurationChange`）。
    @ObservationIgnored private var configChangeChain: Task<Void, Error>?

    @ObservationIgnored private lazy var tunnelPort = TunnelControlAdapter(
        controller: controller,
        client: client,
        startAssembly: { [unowned self] in startAssembly() },
        refreshDirectDns: { [unowned self] in _ = await refreshDirectDns() },
        ingestStartupLog: { [unowned self] in startupLogIngest.ingest() }
    )

    // 导入与刷新共用的抓取端口实现（单一 URLSession 配置来源）。
    @ObservationIgnored private let directFetcher = HttpConfigFetcher()

    // 上一次抓取走了哪条路。读它的前提是「任一时刻至多一个抓取在飞」——
    // AppActions 是 @MainActor 隔离的，全部抓取在此串行。
    @ObservationIgnored private var lastAttempt = FetchAttempt(route: .primary, denial: nil)

    // 两跳抓取只装配一次，导入与刷新共用同一实例（三条路径零分支）。
    @ObservationIgnored private let devPreferences = DevPreferences()

    @ObservationIgnored private lazy var fetcher: ConfigFetcher = AcceleratedConfigFetcher(
        direct: directFetcher,
        trustedSha256: DomainVerify.TRUSTED_SHA256,
        acceleratorBase: { [unowned self] in acceleratorBase },
        forceFallback: { [unowned self] in devPreferences.forceFallback() },
        onAttempt: { [unowned self] attempt in lastAttempt = attempt }
    )

    // 本机用量的只读入口与孤儿回收单点。
    @ObservationIgnored private let usageReader = UsageReader()

    // core 流水线装配；now/newId 是平台实现。
    @ObservationIgnored private lazy var importFlow = ImportFlow(
        fetcher: fetcher,
        tunnel: tunnelPort,
        store: profileStore,
        trusted: DomainVerify.TRUSTED_SHA256,
        userAgent: { [unowned self] in UserAgent.build(engineVersion: OneBoxMApp.engineVersion) },
        now: { Int64(Date().timeIntervalSince1970 * 1000) },
        newId: { UUID().uuidString }
    )

    // 刷新管线装配：手动刷新经此唯一实现（写回不变量在 core）。
    @ObservationIgnored private lazy var configRefresh = ConfigRefresh(
        fetcher: fetcher,
        store: profileStore,
        userAgent: { [unowned self] in UserAgent.build(engineVersion: OneBoxMApp.engineVersion) },
        now: { Self.nowMillis() }
    )

    var connected: Bool { controller.connected }
    var sessionStartedAt: Date? { controller.sessionStartedAt }
    var onDemandEnabled: Bool { controller.onDemandEnabled }
    var status: EngineStatus { client.status }
    var traffic: Traffic { client.traffic }
    /// 读数是否已不可信（观察通道断流，或本次会话尚无帧）。呈现方据此走「—」而非旧数字。
    var trafficStale: Bool { client.trafficStale }
    /// 观察通道健康度与距最近一帧的毫秒数（开发者页只读消费，不驱动任何行为）。
    var observationHealth: ObservationHealth { client.observationHealth }
    var observationElapsedMillis: Int64? { client.observationElapsedMillis }
    var sessionStats: SessionStats? { client.sessionStats }
    var sessionStatsStale: Bool { client.sessionStatsStale }
    var groups: [NodeGroup] { client.groups }
    var groupsGeneration: Int { client.groupsGeneration }

    /// 启动失败诊断：本地已登记则用它，否则回落 Monitor 通道；下次成功启动清除。
    ///
    /// 这不是「两份里挑一份」——本地那份在登记时就已按诊断阶梯合成，
    /// 隧道进程写下的真因已经在里面；回落只覆盖「本地压根没登记」那一支（失败由状态迁移发现）。
    /// 诊断 / 时刻 / 来源三件事**一次决定**，判别式只此一处（见 `FailureAttribution`）。
    ///
    /// 回落那一支的来源由 `TunnelClient` 在写入时记下（读盘 `.tunnel` / 实时事件 `.engine`）；
    /// 本地那一支恒 `.app`，由 `FailureAttribution.local` 绑定，不在这里传。
    private var failure: FailureAttribution {
        localAttribution
            .orElse(FailureAttribution(
                error: client.lastError,
                occurredAt: client.lastErrorAt,
                source: client.lastErrorSource
            ))
    }

    var lastError: EngineError? { failure.error }
    var lastErrorAt: Date? { failure.occurredAt }
    var lastErrorSource: FailureSource? { failure.source }

    /// 失败弹层配置指纹行：当前激活 profile 存储内容的指纹（不含内容本身）。
    /// 有意差异（RN 另列 merged 半）：merged 需在弹层内重跑一次模板合并，会把一行诊断变成加载态；
    /// 合并输入（路由模式 / 规则 / 引擎参数 / 直连 DNS）在应用内各自可查，不在此重复。
    var startConfigFingerprint: String? {
        ConfigFingerprint.of(activeConfigContent)
    }

    /// 启动 = 合并装配 + 隧道启动，上限 20s；失败（含 MergeError）落 lastError → 全局失败弹层，不以异常穿透 UI。
    func connect() {
        if startInFlight { return } // 至多一条启动操作在途（UI 门控之外的最后闸门）
        startInFlight = true
        // 本次尝试的边界要划全：本地登记、缓存、**以及盘上那两份**——扩展若压根没被拉起，
        // 盘上上一次的阶段标记没人覆盖，会被报成本次到达过的阶段。
        clearFailureDiagnostics()
        // 隧道侧会在启动沿截断 startup.log，读侧的偏移必须同时归零。
        startupLogIngest.reset()
        Task {
            defer { startInFlight = false }
            do {
                // 用户主动连接沿把按需连接的投影按意图装回去——上一次手动停止把它压掉了。
                // 「手动启动 = 带着这个开关启动」，故这一步排在启动之前。
                await restoreOnDemandProjectionIfIntended()
                try await startTunnel()
            } catch {
                // **系统把这次拉起打回**与「引擎起不来 / 预算到点」不是同一种失败：
                // 判别式在 `FailureAttribution.isSystemRefusal`（取域不取码表），此处只选工厂。
                // 必须在 `describe(error)` **之前**判：那一步把错误字符串化，域与码之后只剩文本。
                let diagnosis = StartFailure.diagnosis(of: error)
                let occurredAt = Date()
                localAttribution = FailureAttribution.isSystemRefusal(error)
                    ? .systemRefused(diagnosis, at: occurredAt)
                    : .local(diagnosis, at: occurredAt)
                // 起不来就别把设备锁在全局接管里——那是一条用户自己走不出来的死路。
                await controller.disarmAllNetworksIfIdle()
            }
        }
    }

    /// 停止同样是「本地操作在途」——置位后由 OS 断开终态清除（与 connect 对称）。
    func disconnect() {
        Task { await disconnectAndWait() }
    }

    /// 可等待的停止：调用方要等到 OS 确认断开，
    /// 而 `disconnect()` 自建 Task 后立即返回、无从等待。两者共用本实现，不各写一套。
    /// - Returns: 是否在上限内等到断开终态；超时返回 false（调用方据此落诊断，不静默）。
    @discardableResult
    func disconnectAndWait() async -> Bool {
        // 与启动同款的闸门：至多一条停止**命令**在途。但已有在途时不能直接返回——等待方必须等到
        // 真的断开，直接返回会让它把「别人正在停」误报成超时。
        if stopInFlight {
            return await waitForStoppedTunnelStatus(updates: controller.statusUpdates(), timeout: .seconds(10))
        }
        stopInFlight = true
        defer { stopInFlight = false }
        // 硬次序，三步都在 stop 之前，一步都不能省也不能换序：
        // ① 先卸全局接管——只做 ② 就停的话，设备会停在「接管 armed 而隧道已断」的全网丢包态；
        // ② 再压按需连接的投影——不压，NEOnDemandRuleConnect 会把 ③ 刚停下的会话立刻拉回来，
        //    用户看到的就是「点了关闭它自己又连上」。意图不动，设置页 Toggle 不受影响。
        await controller.disarmAllNetworks()
        await controller.suspendOnDemandProjection()
        let updates = controller.statusUpdates()
        controller.stop()
        let stopped = await waitForStoppedTunnelStatus(updates: updates, timeout: .seconds(10))
        // 回收时机二：隧道由运行转停止，采样器已不再写那些文件。
        reclaimUsageRecords()
        // 用户主动断开划出了一段的终点。跨过它还活着的旧诊断，下一拍会被当成新结局
        // 重新呈现——用户看到的是「我点了关闭，它弹出上次的失败」。
        clearFailureDiagnostics()
        return stopped
    }

    /// 清掉上一次尝试留下的全部失败诊断——本地登记与隧道进程写在共享容器里的那份都要清。
    ///
    /// 只清本地不够：扩展写的那份谁读都读得到，留着它等于把旧结局钉在诊断阶梯的第 1 级上，恒赢。
    private func clearFailureDiagnostics() {
        localAttribution = .none
        controller.clearTunnelDiagnostics()
        // **清就要真清**：`refreshLastError()` 在盘上已空时早退，旧值原样留着
        //（上一行刚把盘上那份清掉，所以这里恰恰是「读不到新的」那一支）。
        client.clearLastError()
    }

    /// iOS 保活入口 = On-Demand。启用前写入启动快照，保证系统自动拉起时无需 start options。
    func enableOnDemand() async throws {
        let snapshot = try await currentStartOptionsSnapshot()
        try persistStartOptions(snapshot)
        try await controller.enableOnDemand()
    }

    /// 全局接管开着时按需连接不可单独关闭——那会造出一个用户自己走不出来的断网稳定态。
    /// 设置页据 `canDisableOnDemand` 先行禁用该 Toggle；本处是最后一道闸门。
    func disableOnDemand() async throws {
        guard canDisableOnDemand else {
            throw DisableOnDemandRejected(
                description: "on-demand is required while all networks are included"
            )
        }
        try await controller.disableOnDemand()
    }

    var canDisableOnDemand: Bool {
        OnDemandPolicy.canDisable(includeAllNetworks: networkInclusion.includeAllNetworks)
    }

    /// 用户主动连接沿：按意图把按需连接的投影装回去（上一次手动停止把它压掉了）。
    ///
    /// **快照必须先同步再 arm**，与 `enableOnDemand()` 同序：系统自动拉起隧道时读的是 App Group
    /// 里那份启动快照，它是那条路唯一的配置来源。先 arm 再说的话，装回去的是一份可能
    /// 早已过期的配置——用户手动连的是新配置，系统半夜替他拉起的却是旧的。
    ///
    /// 同步失败就**不 arm**：宁可这次没有自动拉起，也不让系统拿着一份错配置去连。本次手动连接
    /// 照常进行，它自己的失败诊断照常呈现，不被这里抢先。
    private func restoreOnDemandProjectionIfIntended() async {
        guard controller.onDemandEnabled else { return }
        do {
            try await syncStartOptionsSnapshotIfConfigured()
        } catch {
            logAction("on-demand restore skipped, start snapshot sync failed: \(describe(error))")
            return
        }
        await controller.restoreOnDemandIfIntended()
    }

    func toggle() {
        if connected { disconnect() } else { connect() }
    }

    /// 手动/自动导入：经 core ImportFlow 驱动，相位经 onPhase 依序可见，
    /// 终态即返回值；调用方取消原样上抛。
    func requiresTunnelAuthorization(for payload: ImportPayload) -> Bool {
        shouldPrepareTunnelAuthorization(payload, trusted: DomainVerify.TRUSTED_SHA256)
    }

    func prepareTunnelAuthorization() async throws {
        try await controller.prepareAuthorization()
    }

    func importProfile(payload: ImportPayload, onPhase: (ImportPhase) -> Void = { _ in }) async throws -> ImportPhase {
        defer { publishProfiles() }
        let phase = try await importFlow.run(payload: payload, onPhase: onPhase)
        if case .failed = phase {
            logAction("profile import finished: \(phase.token)", level: .error)
        } else {
            logAction("profile import finished: \(phase.token)")
            // 导入换掉了激活配置，故启动快照必须跟上——它是 On-Demand 与控制中心控件
            // 拉起隧道时的唯一配置来源，不同步会让它们在用户明明已经导入之后仍用旧配置。
            // 只写文件、不碰隧道：连接期间手动导入**不**触发热重载。
            try await syncStartOptionsSnapshotIfConfigured()
        }
        return phase
    }

    /// 激活切换；隧道处置见 `applyActiveProfileChange()`。启动失败异常上抛（诊断另经 lastError 进失败弹层）。
    func activate(id: String) async throws {
        profileStore.setActive(id)
        publishProfiles()
        logAction("profile activated: \(activeProfile?.name ?? id)")
        try await applyActiveProfileChange()
    }

    /// 当前配置换了之后的隧道处置 = applyConfigurationChange 单点。
    func applyActiveProfileChange() async throws {
        try await applyConfigurationChange()
        if connected { triggerLatencyTests() } // 延迟测试三触发之「激活 profile 变化」
    }

    /// 按 id 取存下来的原文；非激活项由 ProfileStore 按需回读，读完不驻留。
    func profileContent(id: String) -> String {
        profileStore.contentOf(id)
    }

    /// 删除（激活提升语义在 ProfileStore.remove，本层只重发快照）。
    func deleteProfile(id: String) {
        profileStore.remove(id)
        publishProfiles()
        logAction("profile removed")
    }

    /// 改名（去空白与空名拒绝归 ProfileStore.rename）：只有写入了才重发快照、记一笔。
    @discardableResult
    func renameProfile(id: String, name: String) -> RenameOutcome {
        let outcome = profileStore.rename(id, to: name)
        if outcome == .renamed {
            publishProfiles()
            logAction("profile renamed")
        }
        return outcome
    }

    /// 手动刷新（写回不变量归 core ConfigRefresh / ProfileStore.applyRefresh）；取消原样上抛。
    func refreshProfile(url: String) async throws -> RefreshOutcome {
        defer { publishProfiles() }
        let outcome = try await runRefresh(url: url, trigger: .manual)
        switch outcome {
        case .updated(_, let contentChanged):
            logAction("profile refresh finished: updated(contentChanged=\(contentChanged))")
        case .dropped:
            logAction("profile refresh finished: dropped", level: .warn)
        case .failed(let error):
            logAction("profile refresh failed: \(error.token)", level: .error)
        }
        return outcome
    }

    /// 对全部 profile 各刷一次，**串行逐个**——并发批量会让多个非激活 profile 的内容
    /// 同时驻留内存，打破「非激活内容不进内存」。
    func refreshAllProfiles() async {
        let urls = profileStore.getAll().map(\.url)
        for url in urls {
            // 失败静默：领域失败已由 ConfigRefresh 收成 .failed；这里只挡取消。
            _ = try? await runRefresh(url: url, trigger: .auto)
        }
        publishProfiles()
        logAction("background refresh swept \(urls.count) profiles")
    }

    /// 一次刷新 = 一次写回 + 一条执行记录。
    private func runRefresh(url: String, trigger: RefreshTrigger) async throws -> RefreshOutcome {
        let startedAt = Self.nowMillis()
        lastAttempt = FetchAttempt(route: .primary, denial: nil)
        let outcome = try await configRefresh.run(url: url)
        refreshRecords.append(record(url: url, trigger: trigger, outcome: outcome, startedAt: startedAt))
        return outcome
    }

    private func record(
        url: String,
        trigger: RefreshTrigger,
        outcome: RefreshOutcome,
        startedAt: Int64
    ) -> RefreshRecord {
        // 来源已删（dropped）时取不到 profile：id/name 留空，那正是「写回落了空」的如实记录。
        let profile = profileStore.getAll().first { $0.url == url }
        let finishedAt = Self.nowMillis()
        let recordOutcome: RefreshRecordOutcome
        var contentChanged = false
        var errorToken = ""
        switch outcome {
        case .updated(_, let changed):
            recordOutcome = .updated
            contentChanged = changed
        case .dropped:
            recordOutcome = .dropped
        case .failed(let error):
            recordOutcome = .failed
            errorToken = error.token
        }
        return RefreshRecord(
            occurredAtMillis: finishedAt,
            profileId: profile?.id ?? "",
            profileName: profile?.name ?? "",
            trigger: trigger,
            outcome: recordOutcome,
            contentChanged: contentChanged,
            durationMillis: finishedAt - startedAt,
            route: lastAttempt.route,
            denial: lastAttempt.denial,
            errorToken: errorToken,
            usedTraffic: profile?.usedTraffic ?? 0,
            totalTraffic: profile?.totalTraffic ?? 0,
            expireTime: profile?.expireTime ?? 0
        )
    }

    private static func nowMillis() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    /// 时间线快照，最新在前。
    func refreshRecordTimeline() -> [RefreshRecord] { refreshRecords.all() }

    /// 开关只改「主 URL 那一跳的结局」，闸门不变。
    func forceFallback() -> Bool { devPreferences.forceFallback() }

    func setForceFallback(_ enabled: Bool) {
        devPreferences.setForceFallback(enabled)
        logAction("force fallback set: \(enabled)")
    }

    /// 开关翻转即刻同步周期任务的注册/注销。
    func backgroundRefresh() -> Bool { devPreferences.backgroundRefresh() }

    func setBackgroundRefresh(_ enabled: Bool) {
        devPreferences.setBackgroundRefresh(enabled)
        onBackgroundRefreshChanged(enabled)
        logAction("background refresh set: \(enabled)")
    }


    /// 切换 = 立即持久化 + applyConfigurationChange（未运行仅落盘，零引擎调用；持久化先于重启）。
    func setRoutingMode(_ mode: RoutingMode) async throws {
        RoutingModePreference.store(mode)
        routingMode = mode
        mergeRevision &+= 1
        logAction("routing mode set: \(mode.token)")
        try await applyConfigurationChange()
    }

    /// 切换 = 立即持久化 + `applyConfigurationChange(.nextStartOnly)`（恒不动隧道）。
    /// 该值摊成系统 VPN protocol 的属性，只有重新保存偏好并重开会话才生效——生效时机交给用户
    /// 下一次手动启动，高级设置这一层不代他动隧道。
    ///
    /// **关闭沿仍须就地解除全局接管**：零处置意味着 `NEVPNProtocol` 整份不被重写，
    /// 于是用户在高级设置里关掉「包含所有网络」只落了 UserDefaults——系统配置里那份仍然 armed。
    /// 而设备被全局丢包时隧道必然处于未运行，用户此刻做的正是「去把这个开关关掉」，却什么也
    /// 没发生。
    func setNetworkInclusion(_ value: NetworkInclusion) async throws {
        guard value != networkInclusion else { return }
        networkInclusionStore.set(value)
        networkInclusion = value
        logAction("vpn inclusion set: all=\(value.includeAllNetworks) apns=\(value.includeAPNs)")
        // kill switch 一旦打开，按需连接必须跟着打开——否则存在「接管开着、隧道断着、
        // 没有任何东西会把它拉回来」的稳定态，用户只能靠自己想到去开 App 才救得回来。
        // 关闭方向不联动：那是用户自己的开关。
        if OnDemandPolicy.intentAfterInclusionChange(
            includeAllNetworks: value.includeAllNetworks,
            currentIntent: controller.onDemandEnabled
        ), !controller.onDemandEnabled {
            try await enableOnDemand()
        }
        await controller.disarmAllNetworksIfIdle()
        try await applyConfigurationChange(.nextStartOnly)
    }

    /// 区域切换 = 只持久化。
    /// 刻意不 applyConfigurationChange、不碰合并装配——本设置本期零运行时效果。
    func setRegion(_ value: Region) {
        RegionPreference.store(value)
        region = value
        logAction("region set: \(value.token)")
    }

    /// 批量添加 = 持久化（幂等去重在 RuleStore.add）+ applyConfigurationChange。
    func addRules(_ newRules: [Rule]) async throws {
        ruleStore.add(newRules)
        publishRules()
        logAction("rules added: \(newRules.count)")
        try await applyConfigurationChange()
    }

    /// 编辑提交 = replace（可跨 action 迁移，与既有条目重复时幂等去重）+ applyConfigurationChange。
    func replaceRule(old: Rule, new: Rule) async throws {
        ruleStore.replace(old: old, new: new)
        publishRules()
        logAction("rule replaced")
        try await applyConfigurationChange()
    }

    /// 确认后的删除 = 持久化 + applyConfigurationChange。
    func removeRule(_ rule: Rule) async throws {
        ruleStore.remove(rule)
        publishRules()
        logAction("rule removed")
        try await applyConfigurationChange()
    }

    /// 一次启动的装配：合并输入与记账归属同一拍取出。
    /// 镜像 Android `CompiledStart`——合并是异步的，事后再读一次「当前激活」会在切换瞬间张冠李戴。
    func startAssembly() -> StartAssembly {
        StartAssembly(input: mergeInput(), profileId: profileStore.getActive()?.id ?? "")
    }

    /// iOS 的系统守护进程受高水位清理威胁，排除项按预算分流。
    private static var tunExclusionPolicy: TunExclusionPolicy {
        ConfigMerge.iosTunExclusionPolicy
    }

    /// 单一装配：启动路径、按需连接快照、配置查看页与设置页 DNS 行共用本输入工厂，
    /// 全部经 `ConfigMerge.merge` 出字节（合并可移出主线程执行，输入装配留在主线程）。
    ///
    /// 读 profileStore 存储真相而非 activeProfile 缓存投影：apply 导入的启动发生在流水线内部，
    /// 此刻缓存尚未随 defer 刷新——读缓存会在首装时取到空、有旧档时取到上一份配置（镜像 Android mergeInput）。
    func mergeInput() -> MergeInput {
        MergeInput(
            importedConfig: profileStore.activeContent(),
            template: Self.templateText(for: routingMode),
            mode: routingMode,
            rules: ruleStore.getAll(),
            logLevel: Self.mergeLogLevel,
            directDns: directDns ?? "", // 启动前探测胜者；未探测过/零响应为空 → 合并时回落
            tunExcludeField: ConfigMerge.tunExcludeApple,
            tunExclusionPolicy: Self.tunExclusionPolicy
        )
    }

    /// 全仓唯一探测入口（单飞）——启动路径在合并装配前 await；并发调用共享同一在途竞速。
    /// 结局写内存态 + 一行 APP 日志；竞速与阻塞 IO 在 Net/DnsRace（不占主线程）。
    ///
    /// 发包门在这里而不在各调用点：入口只有一个，门也只该有一处。
    func refreshDirectDns() async -> String? {
        guard directDnsProbeAllowed(osConnected: connected, engineStatus: status) else {
            // 隧道未完全停止时不发包：此刻的 UDP:53 会被自己的 hijack-dns 就地作答，
            // 测出来的胜者与直连可达性无关。沿用上一次隧道未建立时的胜者。
            logAction("direct dns probe skipped: tunnel not fully stopped", level: .debug)
            return directDns
        }
        if let flight = dnsFlight { return await flight.value }
        let flight = Task.detached { await DnsRace.race() }
        dnsFlight = flight
        let winner = await flight.value
        dnsFlight = nil
        // 出发时开着的门，回来时可能已经关了：竞速期间隧道被别的入口（On-Demand / 控制中心控件）
        // 连上，这次竞速的应答就已经是被 hijack-dns 就地作答的那种。开始时检查不够，落盘前要再判一次。
        guard directDnsProbeAllowed(osConnected: connected, engineStatus: status) else {
            logAction("direct dns probe discarded: tunnel came up mid-probe", level: .debug)
            return directDns
        }
        if directDns != winner { mergeRevision &+= 1 }
        directDns = winner
        // 探测结局 debug 级(默认呈现档不显示,日志页调 debug 追溯可见)。
        logAction("direct dns probe: \(winner ?? "none")", level: .debug)
        return winner
    }

    func selectNode(tag: String) {
        client.selectNode(tag: tag)
    }

    /// 延迟测试触发单点（三触发源：连接成功 / 激活变化 / 回前台；无任何手动测速入口）：
    /// 开 12s 测试窗口并对出口选择组触发一次 urlTest；此后由引擎配置内周期驱动。
    /// 只测出口选择组：它的成员由引擎交给覆盖它们的自动组去量，再对自动组发一次只会让同一批
    /// 节点紧接着被重测一轮。
    func triggerLatencyTests() {
        latencyWindowGeneration += 1
        let generation = latencyWindowGeneration
        latencyTesting = true
        monitor.urlTest(tag: NodeSelection.exitGroupTag)
        Task {
            try? await Task.sleep(for: Self.latencyTestWindow)
            if generation == latencyWindowGeneration { latencyTesting = false }
        }
    }

    // 启动路径分派：有激活配置走合并装配（20s 上限，超时/失败抛引擎诊断）；
    // 无激活配置仅 debug 引导可达（最小直连验收隧道生命周期），release 下 UI 空态门控保证不可达。
    private func startTunnel() async throws {
        if !activeConfigContent.isEmpty {
            try await tunnelPort.start()
            return
        }
        precondition(!debugFallbackConfig.isEmpty, "connect requires an active profile")
        // 引导配置无归属（空串），该会话不记账。
        controller.start(
            options: try TunnelStartOptionsSnapshot(config: debugFallbackConfig)
        )
    }

    private func currentStartOptionsSnapshot() async throws -> TunnelStartOptionsSnapshot {
        if !profileStore.activeContent().isEmpty {
            _ = await refreshDirectDns()
            // **在 DNS await 之后**再取装配——合并输入与归属必须来自同一拍，
            // 在 await 之前捕获 id、之后才读内容，等待期间切了配置就会「B 的配置 + A 的归属」。
            let assembly = startAssembly()
            let input = assembly.input
            let config: String
            do {
                config = try await Task.detached(priority: .userInitiated) {
                    try ConfigMerge.merge(input)
                }.value
            } catch let merge as MergeError {
                throw EnableOnDemandFailure(description: "config merge failed: \(merge.message)")
            }
            return try TunnelStartOptionsSnapshot(config: config, profileId: assembly.profileId)
        }
        if !debugFallbackConfig.isEmpty {
            // 引导配置无归属（空串），该会话不记账。
            return try TunnelStartOptionsSnapshot(config: debugFallbackConfig)
        }
        throw EnableOnDemandFailure(description: "on-demand requires an active profile")
    }

    private func syncLatestStartOptionsSnapshot() async throws {
        try persistStartOptions(try await currentStartOptionsSnapshot())
    }

    /// 启动快照无条件同步的入口：**尚无可装配的配置不是失败**。
    ///
    /// 与 `syncLatestStartOptionsSnapshot()` 分开而不是就地 `try?`：那样会把「还没导入过」
    /// 和「合并真的失败了」吞成同一件事，而后者必须让调用方看见。
    private func syncStartOptionsSnapshotIfConfigured() async throws {
        guard !profileStore.activeContent().isEmpty || !debugFallbackConfig.isEmpty else { return }
        try await syncLatestStartOptionsSnapshot()
    }

    private func persistStartOptions(_ snapshot: TunnelStartOptionsSnapshot) throws {
        try TunnelFileAccess.current.write(try snapshot.encoded(), to: .startOptions)
    }

    // 配置变更处置单点：引擎字节类在已连接 → 热重载（系统 VPN
    // 会话不断）、正在启动 → 完整重启、未运行 → 只落盘；下轮启动生效类不看相位、恒不动隧道
    //。判据在 Core，本层只声明变更种类，不自行判断该做哪一种。
    //
    // **启动快照无条件先同步**：那份快照同时是 On-Demand 与控制中心控件拉起隧道时的
    // 唯一配置来源，只在要动隧道时才写会让它们用上一份配置。
    private func applyConfigurationChange(_ change: ConfigChange = .engineConfig) async throws {
        // **`@MainActor` 不等于跨 await 串行**：两次配置变更可以交错成「A 捕获旧输入 → B 写新
        // 快照并重载 → A 晚到又把快照覆盖回旧的并再重载一次」，最终跑的是旧配置。故按调用序
        // 排成一条链——这是 Android `restartGuard` 在 Apple 侧的对等物。
        let previous = configChangeChain
        let task = Task { @MainActor [weak self] in
            _ = await previous?.result
            guard let self else { return }
            try await self.performConfigurationChange(change)
        }
        configChangeChain = task
        try await task.value
    }

    private func performConfigurationChange(_ change: ConfigChange) async throws {
        do {
            try await syncStartOptionsSnapshotIfConfigured()
        } catch {
            // 下轮启动生效类不走下面那条拆到断开——「设定已落盘、引擎仍跑旧配置」正是
            // 这一类规定的正常态，不是要靠断开消除的不一致。落一行日志后原样上抛，隧道不动；
            // 设定已经在盘上，下一次启动照正常启动路径走，真诊断在那里给出。
            // 反过来做的代价很具体：激活 profile 已损坏时，用户在参数页存一个数值就会把他正
            // 连着的隧道拆掉，而他既没改配置也无从知道为什么。
            if change == .nextStartOnly {
                logAction("start options snapshot sync failed, tunnel untouched: \(describe(error))", level: .warn)
                throw error
            }
            // 装配失败发生在命令发出**之前**：隧道那边什么都没听见，旧引擎会带着旧配置继续跑，
            // 而设定已经落盘、UI 已经改了。这种不一致不许留着，故一律拆到断开。
            try await failConfigurationChange(error)
        }
        let phase = sessionPhase(osConnected: connected, engineStatus: status)
        switch configChangeDisposition(phase: phase, change: change) {
        case .none:
            return
        case .reload:
            try await reloadForConfigurationChange()
        case .restart:
            try await restartForConfigurationChange()
        }
    }

    private func reloadForConfigurationChange() async throws {
        do {
            try await controller.reload()
        } catch {
            // 不自愈。**也不能假定扩展收到过命令**：session 不可用、应答缺失、20 秒超时
            // 这几条路径下扩展可能压根没被叫到，指望它自己 `cancelTunnelWithError` 会留下一个
            // 带旧配置继续跑的引擎。故由本侧显式停止。
            try await failConfigurationChange(error)
        }
    }

    /// 配置变更失败的统一收口：**先按阶梯合成诊断**再登记，随后把隧道拆到断开 + 上抛。
    private func failConfigurationChange(_ error: Error) async throws -> Never {
        // **本处有意不判「系统拒绝」**：系统给的断开原因只在「本次尝试被打回」那一沿属于本次，
        // 而热重载失败时隧道可能还活着，取到的会是**上一次会话**的原因。
        localAttribution = .local(
            reloadDiagnosis(transportError: error, tunnelDiagnosis: client.lastError), at: Date())
        if sessionPhase(osConnected: connected, engineStatus: status) != .notRunning {
            await tunnelPort.stop()
        }
        // 隧道已拆到断开且不自愈，全局接管留在那里只会让用户连排查都做不了。
        await controller.disarmAllNetworksIfIdle()
        throw error
    }

    private func restartForConfigurationChange() async throws {
        await tunnelPort.stop()
        do {
            try await tunnelPort.start()
        } catch {
            // **本处同样不判「系统拒绝」**：`stop()` 丢掉了 `waitForStoppedTunnelStatus` 的 `Bool`，
            // 超时那一支照样返回，调用方分不出「停了」与「等够了」，取到的原因未必属于本次。
            localAttribution = .local(StartFailure.diagnosis(of: error), at: Date())
            throw error
        }
    }

    // APP 源喂入单点：动作层事件（导入/激活/刷新等）落唯一日志缓冲。
    private func logAction(_ message: String, level: LogLevel = .info) {
        logStore.append(source: .app, level: level, message: message)
    }

    private func publishProfiles() {
        profiles = profileStore.getAll()
        activeProfile = profileStore.getActive()
        activeConfigContent = profileStore.activeContent()
        mergeRevision &+= 1
    }

    private func publishRules() {
        rules = ruleStore.getAll()
        mergeRevision &+= 1
    }

    // 模板供给：Bundle 资源由 `make templates` 落位（gitignored 资产）；文件名 = 模式 token；
    // 缺失或不可读 → 装配即崩（装配缺件，不静默兜底）。
    private static func templateText(for mode: RoutingMode) -> String {
        if let cached = templateCache[mode] { return cached }
        guard let url = Bundle.main.url(forResource: mode.token, withExtension: "json") else {
            preconditionFailure("missing template asset \(mode.token).json — run `make templates`")
        }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            preconditionFailure("unreadable template asset: \(url.path)")
        }
        templateCache[mode] = text
        return text
    }
}

private struct EnableOnDemandFailure: Error, CustomStringConvertible {
    let description: String
}

/// 按需连接关闭的最后一道闸门被撞上——设置页本该先禁用那个 Toggle，走到这里说明门控漏了。
private struct DisableOnDemandRejected: Error, CustomStringConvertible {
    let description: String
}

// 持久化单一来源：token 的存与读全仓仅此一处；token↔枚举映射唯一实现于 core RoutingMode
// （未知 token 在 fromToken 崩溃暴露）。默认 tun-rules = 无持久化值时生效。
enum RoutingModePreference {
    private static let key = "routing-mode"

    static func load() -> RoutingMode {
        guard let token = UserDefaults.standard.string(forKey: key) else { return .tunRules }
        return RoutingMode.fromToken(token)
    }

    static func store(_ mode: RoutingMode) {
        UserDefaults.standard.set(mode.token, forKey: key)
    }
}

// 区域持久化：只存 token，键与默认值的唯一定义处即此；
// token↔枚举映射唯一实现于 core Region（未知 token 在 fromToken 内即崩）。
private enum RegionPreference {
    private static let key = "region"

    static func load() -> Region {
        guard let token = UserDefaults.standard.string(forKey: key) else { return .cn }
        return Region.fromToken(token)
    }

    static func store(_ region: Region) {
        UserDefaults.standard.set(region.token, forKey: key)
    }
}

// TunnelControl 端口实现：
// stop = 现有停止 + 轮询等 OS 确认断开（10s 上限，超时或取消均正常返回，对上不抛）；
// start = 合并装配（MergeError → 类型化启动失败诊断，不吞）+ 现有启动路径下发 + 轮询等 OS 确认
// 已连接（20s 上限，超时抛引擎诊断；取消原样上抛）。
/// 一次启动的装配：编译输入 + 记账归属。
struct StartAssembly: Sendable {
    let input: MergeInput
    let profileId: String
}

private final class TunnelControlAdapter: TunnelControl, Sendable {
    private let controller: TunnelController
    private let client: TunnelClient
    private let startAssembly: @MainActor () -> StartAssembly
    private let refreshDirectDns: @MainActor () async -> Void
    /// 启动期引擎日志的回读。以闭包注入而不是持有那个件：本类型是 `Sendable`
    /// 且只持 `let`，而回读件带可变偏移、住在 MainActor 上——与 `startAssembly` 同一姿势。
    private let ingestStartupLog: @MainActor () -> Void

    private static let pollInterval: Duration = .milliseconds(200)

    init(
        controller: TunnelController,
        client: TunnelClient,
        startAssembly: @escaping @MainActor () -> StartAssembly,
        refreshDirectDns: @escaping @MainActor () async -> Void,
        ingestStartupLog: @escaping @MainActor () -> Void
    ) {
        self.controller = controller
        self.client = client
        self.startAssembly = startAssembly
        self.refreshDirectDns = refreshDirectDns
        self.ingestStartupLog = ingestStartupLog
    }

    func stop() async {
        let updates = await MainActor.run { () -> AsyncStream<NEVPNStatus> in
            let updates = controller.statusUpdates()
            controller.stop()
            return updates
        }
        await waitForStoppedTunnelStatus(updates: updates, timeout: .seconds(10))
    }

    func start() async throws {
        // 依赖链：probe（≤500ms）→ merge → start 严格串行（本单点覆盖 connect / 配置变更走完整重启那一支 /
        // 导入 apply 三条启动路径；debug 引导路径不经合并故不探测）。
        await refreshDirectDns()
        let assembly = await MainActor.run { startAssembly() }
        let input = assembly.input
        let config: String
        do {
            config = try await Task.detached(priority: .userInitiated) {
                try ConfigMerge.merge(input)
            }.value
            try Task.checkCancellation()
        } catch let merge as MergeError {
            // 导入内容不可合并 → 启动路径映射为类型化启动失败（经 StartFailed 呈现）。
            throw StartFailure.local(
                EngineError(token: "START_FAILED_GENERIC", detail: "config merge failed: \(merge.message)"))
        }
        // 失败沿基线与发起同拍捕获：沿计数只可能在这之后递增，不漏快失败。
        let startOptions = try TunnelStartOptionsSnapshot(config: config, profileId: assembly.profileId)
        let failureBaseline = await MainActor.run { () -> Int in
            let generation = controller.startFailureGeneration
            controller.start(options: startOptions)
            return generation
        }
        var wait = TunnelStartWait()
        do {
            while true {
                // 每拍回读一次：启动期的引擎日志因此在等待过程中就逐行出现在日志页，
                // 而不是等到有了结局才一次性补上（失败时那一次根本不会来）。
                await MainActor.run { ingestStartupLog() }
                if await controller.connected {
                    await MainActor.run { ingestStartupLog() }
                    return
                }
                // 启动尝试已终止（失败即时可见）：立即取真实诊断失败，不再干等超时。
                if await controller.startFailureGeneration != failureBaseline {
                    await MainActor.run {
                        controller.cancelStart()
                        ingestStartupLog()
                    }
                    throw await terminatedFailure()
                }
                wait.observe(requestSubmitted: await controller.startRequestSubmitted, at: .now)
                if wait.isExpired(at: .now) { break }
                try await Task.sleep(for: Self.pollInterval)
            }
        } catch {
            await MainActor.run { controller.cancelStart() }
            throw error
        }
        // 预算到点先分流,两支的结局根本不同类。
        let everStarted = await MainActor.run { controller.sessionEverLeftDisconnected }
        guard everStarted else {
            // 系统收下了启动请求却从没推进这次会话——这是**确定的失败**（扩展注册被覆盖安装
            // 打断、配置未启用、权限被撤都落在这里）。放弃这次尝试并落诊断。
            await MainActor.run {
                controller.cancelStart()
                // 收口再读一次：最后那几行往往正是「卡在哪」的答案。
                ingestStartupLog()
            }
            // 会话从未开始时系统是唯一知情者，此时它给的原因按构造即属本次（隧道并没有活着）。
            let systemFailure = await controller.lastDisconnectError()
            let systemDetail = controller.systemDisconnectDetail(for: systemFailure)
            if let disabled = await extensionDisabledFailure(systemFailure, systemDetail: systemDetail) {
                throw disabled
            }
            throw StartFailure.local(startNeverBeganDiagnosis(systemDetail: systemDetail))
        }
        // 会话仍在推进：**只结束等待，不结束会话**。此后这次尝试的结局由会话
        // 自己在终止沿发布——把发布权攥在这里不放，就只能靠掐掉会话来制造一个结局。
        await MainActor.run {
            controller.stopWaitingForStart()
            ingestStartupLog()
        }
    }

    /// 诊断阶梯前两级：隧道进程自己写下的诊断（引擎错误 / 启动阶段）。
    ///
    /// 失败拍读诊断必须过 refresh：挂载缓存只在初始化读过一次，失败发生在其后。
    private func freshDiagnostic() async -> String? {
        await freshTunnelDiagnosis()?.detail
    }

    /// 同上，但保留类型——合成要判「有没有真因」，而不是判一个字符串空不空。
    ///
    /// **纯查询**：合成期间不得发布。带副作用地去读会把未合成的那句先写进
    /// `client.lastError`，`lastError` 因此在合成完成前就非空，失败弹层当场 latch 住它
    /// （只认第一次 nil→非空），合成结果再也上不了台面——见 `TunnelClient.tunnelDiagnosis`。
    private func freshTunnelDiagnosis() async -> EngineError? {
        await MainActor.run { client.tunnelDiagnosis() }
    }

    /// 诊断全阶梯，**只用于「系统刚把本次尝试从 connecting 打回 disconnected」那一沿**。
    ///
    /// 第 3 级（系统给的断开原因）不带时刻，只保证是「最近一次断开的原因」；在这一沿它按构造
    /// 即属本次尝试。超时沿没有这个保证——那时隧道可能还活着，取到的会是上一次会话的原因，
    /// 故超时沿只用前两级。
    /// 终止沿的诊断：**这一沿 App 确知的是「会话被打回了」**，而阶梯前两级只给事实。
    /// 三段全拼、确知的那句恒在最前：否则合成结果与超时沿逐字相同，第 3 级也会被阶段标记挡在后面。
    private func terminatedFailure() async -> StartFailure {
        let systemFailure = await controller.lastDisconnectError()
        let systemDetail = controller.systemDisconnectDetail(for: systemFailure)
        if let disabled = await extensionDisabledFailure(systemFailure, systemDetail: systemDetail) {
            return disabled
        }
        return .local(EngineError(
            token: "START_FAILED_GENERIC",
            detail: DiagnosisDetail.join([
                "the start attempt ended before the engine reported started",
                "the VPN session returned to disconnected",
                await freshDiagnostic(),
                systemDetail,
            ])
        ))
    }

    /// 系统说扩展被关掉了：这一句压过一切，隧道诊断读不读得到都只是它的旁证。
    private func extensionDisabledFailure(_ systemFailure: Error?, systemDetail: String?) async -> StartFailure? {
        return nil
    }
}

func isStoppedTunnelStatus(_ status: NEVPNStatus) -> Bool {
    status == .disconnected || status == .invalid
}

/// - Returns: true = 等到了断开终态；false = 超时（调用方据此落诊断，不静默）。
@discardableResult
private func waitForStoppedTunnelStatus(updates: AsyncStream<NEVPNStatus>, timeout: Duration) async -> Bool {
    await withTaskGroup(of: Bool.self) { group in
        group.addTask {
            for await status in updates {
                if isStoppedTunnelStatus(status) { return true }
            }
            return false
        }
        group.addTask {
            try? await Task.sleep(for: timeout)
            return false
        }
        let first = await group.next() ?? false
        group.cancelAll()
        return first
    }
}

