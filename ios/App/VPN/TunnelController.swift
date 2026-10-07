import Foundation
@preconcurrency import NetworkExtension
import Observation
import Core
import os.log
import WidgetKit

private let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "TunnelController")
private let signposter = OSSignposter(logger: logger)

private enum OnDemandProjection {
    case enabled
    case disabled
}

private enum ManagerPreferenceLoad {
    case cached
    case refresh
}

@MainActor
protocol TunnelSessionAccess: AnyObject {
    func statusUpdates() -> AsyncStream<NEVPNStatus>
    func sendProviderCommand(_ payload: Data) throws
    func requestProviderMessage(_ payload: Data, timeout: TimeInterval) async throws -> Data
}

enum TunnelSessionAccessError: LocalizedError {
    case sessionUnavailable
    case preferencesTimedOut
    case responseMissing
    case responseTimedOut

    var errorDescription: String? {
        switch self {
        case .sessionUnavailable: "tunnel provider session unavailable"
        case .preferencesTimedOut: "tunnel preferences request timed out"
        case .responseMissing: "tunnel provider response missing"
        case .responseTimedOut: "tunnel provider response timed out"
        }
    }
}

private final class ProviderMessageReply: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?

    init(_ continuation: CheckedContinuation<Data, Error>) {
        self.continuation = continuation
    }

    func resolve(_ result: Result<Data, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
    }
}

/// NetworkExtension 的 manager 不是 Sendable；本包装只在 TunnelController 的 MainActor 内拆封。
private final class TunnelManagerReference: @unchecked Sendable {
    let value: NETunnelProviderManager?

    init(_ value: NETunnelProviderManager?) {
        self.value = value
    }
}

// 启停控制 + 连接真相。连接生命周期以 OS VPN 状态为权威：
// 观察 NEVPNStatus，STARTED（.connected）即视为已连接。
@MainActor
@Observable
final class TunnelController {
    private(set) var connected: Bool = false

    /// 本次系统 VPN 会话的起点（系统记的连上时刻）；不在会话里为 nil。
    ///
    /// 取系统的而不是本进程记一笔：App 被杀后重开、隧道一直连着时，本进程能记到的只是重开那一刻。
    /// 只在「没连着 → 连着」那一沿读一次：热重载走 `.reasserting` 再回 `.connected`，
    /// 系统会不会借机把 `connectedDate` 刷成新时刻没有承诺，沿上只读一次，重载就清不掉本次时长。
    private(set) var sessionStartedAt: Date?

    /// 按需连接的**用户意图**——设置页读的、显示的都是它。
    /// 系统侧的 `isOnDemandEnabled` 只是它的投影，停止沿会把投影压掉而意图分毫不动。
    private(set) var onDemandEnabled: Bool = false

    /// 本次启动尝试期间，VPN 会话有没有离开过断开态。
    /// 从未离开 = 系统收下了启动请求却没去拉隧道进程，与「引擎没起来」是两类问题。
    private(set) var sessionEverLeftDisconnected = false

    /// 本次启动尝试的启动请求是否已交给系统。之前的存配置可能停在系统的「添加 VPN 配置」弹窗上等用户。
    @ObservationIgnored private(set) var startRequestSubmitted = false

    /// 启动尝试终止沿计数（失败即时可见）：启动等待者据此立即收场，不干等超时。
    private(set) var startFailureGeneration = 0

    /// 本次启动尝试还有没有等待者。`start(options:)` 置真，预算沿或放弃时置假。
    ///
    /// 终止沿据此决定由谁收场：等待者在场就由它（它要把失败当场交给发起方——导入流水线靠这个
    /// 把 `.applied` 判成 `.failed`）；等待者已走，会话自己发布，否则失败会悄无声息。
    @ObservationIgnored private var startWaiterPresent = false

    /// 终止沿的结局出口。**发布权属于会话，不属于等待者**：等待者可能在预算沿停等，
    /// 之后真正发生的失败仍要有人发布；发布权挂在等待者身上，它就只能掐掉会话来制造一个结局。
    @ObservationIgnored private var publishStartFailure: (@MainActor () -> Void)?

    @ObservationIgnored private let logStore: LogStore
    @ObservationIgnored private let sessionReport: TunnelSessionReport
    @ObservationIgnored private let networkInclusion: () -> NetworkInclusion
    /// 按需连接意图的唯一读写处。
    @ObservationIgnored private let onDemandIntentStore: OnDemandIntentStore

    /// 系统 VPN 会话停稳了：本应用的隧道进程此刻不在跑，它的入站也就不在听。
    var sessionStopped: Bool { isStoppedTunnelStatus(neStatus) }

    @ObservationIgnored private var manager: NETunnelProviderManager?
    @ObservationIgnored private var managerLoadTask: Task<Void, Never>?
    @ObservationIgnored private var managerLoadTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private var managerLoadWaiters: [CheckedContinuation<TunnelManagerReference, Error>] = []
    @ObservationIgnored private var managerLoadGeneration = 0
    @ObservationIgnored private var managerPreferencesLoaded = false
    @ObservationIgnored private var statusObserver: NSObjectProtocol?
    @ObservationIgnored private var neStatus: NEVPNStatus = .invalid
    @ObservationIgnored private var statusContinuations: [UUID: AsyncStream<NEVPNStatus>.Continuation] = [:]
    @ObservationIgnored private var startAttemptInFlight = false
    @ObservationIgnored private var startTask: Task<Void, Never>?
    @ObservationIgnored private var startGeneration = 0
    @ObservationIgnored private var staleSessionReconciled = false
    @ObservationIgnored private var reloadGeneration: UInt64 = 0

    private static let extensionBundleID = "cloud.oneoh.networktools.tunnel"
    private static let managerLoadTimeout: Duration = .seconds(5)
    /// 与启动等待同一上限：换引擎做的事和启动那一轮一样多。
    /// 取的是同一个来源而不是同一个字面量——两处各写一个 20 时，「它们相等」只是注释里的
    /// 一句口头承诺，改一处忘另一处不会有任何判据变红。
    private static let reloadTimeout: TimeInterval = TunnelStartBudget.timeInterval
    /// 启动期残骸会话的探活上限。取值宽裕：误判「隧道进程已死」会断掉一条正在好好跑的隧道，
    /// 而多等几秒只发生在一个后台任务里、用户无感——两侧代价不对称，故宁可等。
    private static let livenessProbeTimeout: TimeInterval = 5
    /// 热重载应答缺失时的对账窗口。扩展是**先落结局再拆隧道**，故应答一丢，结局通常已经在盘上；
    /// 这段窗口只为容纳写盘与本进程读到之间的那一拍。
    private static let reloadOutcomeSettleTimeout: Duration = .seconds(2)
    private static let reloadOutcomePollInterval: Duration = .milliseconds(50)

    init(
        logStore: LogStore,
        networkInclusion: @escaping () -> NetworkInclusion,
        onDemandIntentStore: OnDemandIntentStore = OnDemandIntentStore()
    ) {
        self.logStore = logStore
        sessionReport = TunnelSessionReport(logStore: logStore)
        self.networkInclusion = networkInclusion
        self.onDemandIntentStore = onDemandIntentStore
        onDemandEnabled = onDemandIntentStore.get()
        Task { [weak self] in
            await self?.loadManager()
            await self?.reconcileStaleSessionOnLaunch()
            await self?.disarmAllNetworksIfIdle()
        }
    }

    /// 全局接管的解除：**隧道不在跑时,系统 VPN 配置里就不该留着 `includeAllNetworks`**。
    ///
    /// **WHY**:该属性在 Apple 侧的语义是双向的——连着时把所有流量收进隧道,
    /// **没连着时把所有流量丢掉**。后半句由系统在 NECP 层执行(`NEPolicySession(AlwaysOnVPN)` /
    /// `applyIPDefaultDrop`),作用于**整台设备**,且随 VPN 配置持久:**重启不解除**。于是隧道进程
    /// 一旦被系统直接杀掉(连接中覆盖安装即如此,`installcoordinationd` 一次杀掉 App / 控件 / 扩展
    /// 三个进程,`stopTunnel` 根本没机会跑),这台设备就此失去全部网络——连别的 VPN 都起不来
    /// (`No network available`),而唯一的解除手段是启用另一份 VPN 配置(它会把我们这份置为
    /// `enabled = 0`)或删掉我们这份。
    ///
    /// 故本仓把它的生命周期收窄成「**只在打算连着的那段时间 armed**」:启动路径按用户设定装上
    /// (`applyNetworkInclusion`),而进程只要发现隧道不在跑就卸掉。用户的设定本身存在
    /// `NetworkInclusionStore`,不受影响——下次连接照旧按它装回去。
    ///
    /// **不做**「一断开就卸」:那会把用户要的防泄漏保护在最需要它的时刻(隧道意外掉线)取消掉。
    /// 卸只发生在**我们确知隧道不会自己回来**的时刻:进程启动那一拍、用户主动断开、启动/重载失败。
    func disarmAllNetworksIfIdle() async {
        guard !connected else { return }
        await disarmAllNetworks()
    }

    /// 无条件卸下全局接管。调用方须自己确认「隧道不会自己回来」（见 `disarmAllNetworksIfIdle` 的 WHY）。
    func disarmAllNetworks() async {
        guard let manager else { return }
        do {
            guard try await Self.disarmAllNetworks(on: manager) else { return }
            try await manager.loadFromPreferences()
            bindManager(manager)
            logStore.append(
                source: .app,
                level: .warn,
                message: "all-networks capture disarmed: tunnel is not running"
            )
        } catch {
            // 卸不掉要响亮:此刻设备很可能正被系统全局丢包,而用户看不到任何解释。
            logStore.append(
                source: .app,
                level: .error,
                message: "all-networks capture disarm failed: \(describe(error))"
            )
        }
    }

    /// 全局接管解除的**后台恢复入口**：系统把 App 唤到后台跑刷新任务时，视图树不渲染，装配的 `.task`
    /// 走不到，`init` 那一拍的解除也就不存在。而「设备已被全局丢包」恰恰是用户不会主动打开
    /// App 的场景（他只看到手机没网、以为是别的问题）——没有这条，恢复就永远等着他自己去点。
    ///
    /// 自带加载与状态判定，不依赖任何已装配的对象；解除逻辑与前台共用下面那一个实现。
    static func disarmAllNetworksIfIdleInBackground() async {
        let managers: [NETunnelProviderManager]
        do {
            managers = try await NETunnelProviderManager.loadAllFromPreferences()
        } catch {
            // 这是设备被全局丢包时**唯一**会自己跑起来的恢复入口（用户只看到手机没网，不会主动
            // 开 App）。静默 return 会让它从此不可见：用户只知道「一直没网」，而日志里一行都没有。
            logger.error("background disarm skipped, preferences unavailable: \(describe(error), privacy: .public)")
            return
        }
        for manager in managers {
            guard let proto = manager.protocolConfiguration as? NETunnelProviderProtocol,
                  proto.providerBundleIdentifier == Self.extensionBundleID else { continue }
            // 连着、正在连、或重连中都不动：那些时刻隧道随时会回来，卸掉等于取消用户要的保护。
            switch manager.connection.status {
            case .connected, .connecting, .reasserting: continue
            // 已知成员列全 + `@unknown default:`：`NEVPNStatus` 非 frozen，
            // 新系统加状态时编译器警告到这一行；裸 `default:` 会把它静默归入「可以卸」。
            case .invalid, .disconnected, .disconnecting: break
            @unknown default: break
            }
            do {
                _ = try await disarmAllNetworks(on: manager)
            } catch {
                logger.error("background disarm failed: \(describe(error), privacy: .public)")
            }
        }
    }

    /// 卸下全局接管的唯一实现。返回是否真的写了——原本就没 armed 时返回 false。
    ///
    /// `excludeLocalNetworks` 一并清掉：它只在 `includeAllNetworks` 为真时被系统读取，留着是死值，
    /// 而死值会让下一个读配置的人以为局域网被排除着。
    @discardableResult
    private static func disarmAllNetworks(on manager: NETunnelProviderManager) async throws -> Bool {
        guard let proto = manager.protocolConfiguration as? NETunnelProviderProtocol,
              proto.includeAllNetworks else { return false }
        proto.includeAllNetworks = false
        proto.excludeLocalNetworks = false
        manager.protocolConfiguration = proto
        try await manager.saveToPreferences()
        return true
    }

    /// 启动期会话对账：OS 说连着，但隧道进程可能是上一代的残骸——它的寿命长于 App 进程，
    /// App 被覆盖安装或被杀后重开时，系统的会话可能还挂在一个已经死掉的进程上。探不到就请系统
    /// 停掉这条会话；不然首页会一直如实显示「已连接」，而数据面是黑洞。
    private func reconcileStaleSessionOnLaunch() async {
        guard StaleSessionGate.probeNeeded(
            connection: connected ? .connected : .notConnected,
            reconciliation: staleSessionReconciled ? .reconciled : .pending
        ) else { return }
        staleSessionReconciled = true
        let responded = await tunnelProviderResponds()
        guard StaleSessionGate.stopNeeded(
            connection: connected ? .connected : .notConnected,
            providerProbe: responded ? .responded : .unresponsive
        ) else { return }
        logStore.append(
            source: .app,
            level: .warn,
            message: "stale tunnel session: provider did not answer, stopping it"
        )
        manager?.connection.stopVPNTunnel()
        // 残骸会话恒伴随全局接管的 armed 状态(隧道当时是连着被杀的),停完立刻卸掉全局接管，
        // 否则设备继续被系统全局丢包，而用户手里唯一还能动的就是这个 App。
        // 这里走无条件版：`connected` 此刻还没落下来，等它会把解除推迟到下一拍。
        await disarmAllNetworks()
    }

    /// 探活复用既有的快照索取通路，不为对账另开一条命令。
    private func tunnelProviderResponds() async -> Bool {
        do {
            _ = try await requestProviderMessage(
                ObservationCommandCodec.encode(.snapshotRequest),
                timeout: Self.livenessProbeTimeout
            )
            return true
        } catch {
            // 「进程真死了」与「探活请求自身出错」在这里折成同一个 false，而误判的代价是掐掉一条
            // 健康隧道——所以至少要把 error 留下，使事后分得清是哪一种。
            logStore.append(
                source: .app,
                level: .warn,
                message: "tunnel provider liveness probe failed: \(describe(error))"
            )
            return false
        }
    }

    /// 启动隧道：安装/启用 profile 后携带 config 启动。需系统授予 VPN 权限（首次会弹窗）。
    /// 启动参数整体传入：配置与记账归属同一次快照捕获，不在这里各读各的。
    func start(options: TunnelStartOptionsSnapshot) {
        logStore.append(source: .app, level: .info, message: "tunnel start requested")
        sessionEverLeftDisconnected = false
        startRequestSubmitted = false
        startWaiterPresent = true
        startTask?.cancel()
        startGeneration += 1
        let generation = startGeneration
        startTask = Task { [weak self] in
            await self?.startTunnel(options: options, generation: generation)
        }
    }

    func stop() {
        cancelStart()
        logStore.append(source: .app, level: .info, message: "tunnel stop requested")
        manager?.connection.stopVPNTunnel()
    }

    /// 热重载：让扩展就地换引擎，**不结束系统 VPN 会话**。
    ///
    /// 载荷 = 命令字节 + 重载 id——最新配置由调用方先写进 App Group 快照，扩展从那里读。
    /// 失败抛出；引擎侧诊断由扩展写 App Group，App 侧经既有通道落失败诊断。
    func reload() async throws {
        logStore.append(source: .app, level: .info, message: "tunnel reload requested")
        reloadGeneration &+= 1
        let id = reloadGeneration
        // 发命令前先抹掉上一份结局：**id 计数器随 App 进程重启归零**，跨会话的旧结局会带着
        // 同一个 id 冒充本次——那份若恰好是「成功」，一次真失败就会被读成成功。抹掉之后，
        // 盘上还在的那份只可能是本次写的。
        Self.clearReloadOutcome()
        let response: Data
        do {
            response = try await requestProviderMessage(
                ObservationCommandCodec.encode(.reload(id: id)),
                timeout: Self.reloadTimeout
            )
        } catch {
            try await settleReloadWithoutResponse(id: id, transportError: error)
            return
        }
        try finishReload(ReloadOutcomeCodec.decode(response))
    }

    /// 「没回话 ≠ 失败」：应答缺失/超时/会话不可用都只是**传输层结局未知**，
    /// 与扩展落盘的结局对账之后才判定成败。
    ///
    /// 不对账就直接判失败，会把一次其实已经成功的重载连同健康的隧道一起拆掉——扩展的失败路径
    /// 本身就要 `cancelTunnelWithError`，拆完之后那条应答通道还能不能回话不由我们决定。
    private func settleReloadWithoutResponse(id: UInt64, transportError: Error) async throws {
        guard let outcome = await awaitReloadOutcome(id: id) else {
            logStore.append(
                source: .app,
                level: .error,
                message: "tunnel reload outcome unknown: \(describe(transportError))"
            )
            throw transportError
        }
        try finishReload(outcome.error)
    }

    private func finishReload(_ failure: EngineError?) throws {
        guard let failure else {
            logStore.append(source: .app, level: .info, message: "tunnel reloaded")
            return
        }
        logStore.append(
            source: .app,
            level: .error,
            message: [failure.token, failure.detail].compactMap { $0 }.joined(separator: ": ")
        )
        throw failure
    }

    /// 等扩展把本次 id 的结局落下来。**认 id 而不是认「文件在不在」**：会话不可用那条路上扩展
    /// 压根没被叫到，读到的会是上一次的结局。
    private func awaitReloadOutcome(id: UInt64) async -> ReloadOutcomeRecord? {
        let deadline = ContinuousClock.now + Self.reloadOutcomeSettleTimeout
        while true {
            if let record = Self.readReloadOutcome(), record.id == id { return record }
            guard ContinuousClock.now < deadline else { return nil }
            try? await Task.sleep(for: Self.reloadOutcomePollInterval)
        }
    }

    /// 结局尚未落盘是**对账窗口内的正常形态**（轮询要等扩展写完那一拍），故文件不存在只回 nil；
    /// 但「文件在却读不出来」不是——那会让一次其实成功的重载被判成失败、连同健康隧道一起拆掉
    ///。两者在 `try?` 下是同一件事，故分开并留痕。
    private nonisolated static func readReloadOutcome() -> ReloadOutcomeRecord? {
        do {
            return try TunnelFileAccess.current.read(.reloadOutcome).flatMap(ReloadOutcomeRecordCodec.decode)
        } catch {
            logger.error("reload outcome read failed: \(describe(error), privacy: .public)")
            return nil
        }
    }

    private nonisolated static func clearReloadOutcome() {
        do {
            // 上一次的结局已被认领或从未产生（文件不在）是正常形态，不算失败。
            try TunnelFileAccess.current.remove(.reloadOutcome)
        } catch {
            // 清不掉的残留会带着同一个 id 冒充下一次的结局（计数器随进程重启归零）。
            logger.error("reload outcome clear failed: \(describe(error), privacy: .public)")
        }
    }

    func enableOnDemand() async throws {
        onDemandIntentStore.set(true)
        onDemandEnabled = true
        try await armOnDemand()
        logStore.append(source: .app, level: .info, message: "on-demand enabled")
    }

    func disableOnDemand() async throws {
        retractOnDemandIntent()
        try await withdrawOnDemandProjection()
    }

    private func retractOnDemandIntent() {
        onDemandIntentStore.set(false)
        onDemandEnabled = false
    }

    private func withdrawOnDemandProjection() async throws {
        guard let manager = try await managerFromPreferences(.refresh) else {
            logStore.append(source: .app, level: .info, message: "on-demand already disabled")
            return
        }
        try await writeOnDemandProjection(.disabled, on: manager)
        logStore.append(source: .app, level: .info, message: "on-demand disabled")
    }

    /// 清掉隧道进程写在共享容器里的诊断。清不掉必须留痕——留着的旧结局会在
    /// 诊断阶梯的第 1 级上恒赢，下一次失败的真因就永远浮不上来。
    func clearTunnelDiagnostics() {
        logUncleared(StartDiagnostic.clear(files: TunnelFileAccess.current))
    }

    private func logUncleared(_ failures: [String]) {
        guard !failures.isEmpty else { return }
        logStore.append(
            source: .app,
            level: .error,
            message: "stale start diagnostics not cleared, they may impersonate the next failure: "
                + failures.joined(separator: "; ")
        )
    }

    /// 停止硬次序第 2 步：把按需连接的**投影**压掉，让紧随其后的停止真的停得住。
    ///
    /// 意图**不动**——设置页显示的始终是意图，否则用户每按一次停止 Toggle 就自己翻掉。
    /// 下一次用户主动连接时由 `restoreOnDemandIfIntended()` 按意图把投影装回去。
    func suspendOnDemandProjection() async {
        guard let manager = try? await managerFromPreferences(.refresh),
              manager.isOnDemandEnabled else { return }
        do {
            try await writeOnDemandProjection(.disabled, on: manager)
            logStore.append(source: .app, level: .info, message: "on-demand suspended for manual stop")
        } catch {
            // 压不掉就意味着这次停止会被系统立刻拉回来——用户会看到「点了关闭它自己又连上」。
            // 静默吞掉的话，那个现象在日志里没有任何对应物。
            logStore.append(
                source: .app,
                level: .error,
                message: "on-demand suspend failed, the stop may be reverted by the system: \(describe(error))"
            )
        }
    }

    /// 用户主动连接沿：按意图把投影装回去。意图为假则什么都不做。
    func restoreOnDemandIfIntended() async {
        guard onDemandIntentStore.get() else { return }
        do {
            try await armOnDemand()
            logStore.append(source: .app, level: .info, message: "on-demand restored from intent")
        } catch {
            logStore.append(
                source: .app,
                level: .error,
                message: "on-demand restore failed, auto-reconnect will not happen: \(describe(error))"
            )
        }
    }

    private func armOnDemand() async throws {
        let manager = try await loadOrCreateManager()
        manager.isEnabled = true
        try await writeOnDemandProjection(.enabled, on: manager)
    }

    /// 投影的唯一写入处：规则与开关必须一起改，分开写会留下「开关关了规则还在」的半态。
    private func writeOnDemandProjection(_ projection: OnDemandProjection, on manager: NETunnelProviderManager) async throws {
        if projection == .enabled {
            let rule = NEOnDemandRuleConnect()
            rule.interfaceTypeMatch = .any
            manager.onDemandRules = [rule]
        } else {
            manager.onDemandRules = []
        }
        manager.isOnDemandEnabled = projection == .enabled
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
        bindManager(manager)
    }

    /// 首装自动应用的授权前置：保存空载荷的系统隧道配置会先触发 VPN 配置授权，
    /// 授权完成后导入页才开始远端抓取，避免下载与系统授权并行造成错误相位。
    func prepareAuthorization() async throws {
        let manager = try await loadOrCreateManager()
        manager.isEnabled = true
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
        bindManager(manager)
    }

    /// 装上终止沿的结局出口（装配期一次）。出口缺席时终止沿只留日志与计数，失败会悄无声息。
    func installStartFailurePublisher(_ publisher: @escaping @MainActor () -> Void) {
        publishStartFailure = publisher
    }

    /// 启动预算沿：等待者不再等了，把结局的发布权交还给会话。
    ///
    /// **刻意不碰 `startAttemptInFlight`**：那一位正是终止沿的触发条件，此刻清掉它，
    /// 之后真发生的失败就再也不会被识别为「本次尝试失败」。停等不是放弃，故不走 `cancelStart()`。
    func stopWaitingForStart() {
        startWaiterPresent = false
    }

    /// 放弃这次启动尝试：只撤销**本进程这一侧**的在途状态，不碰系统会话——
    /// 在 `.connecting` / `.reasserting` 时停隧道只会掐掉一条正在好起来的会话；真要停隧道的 `stop()` 自己会停。
    func cancelStart() {
        startGeneration += 1
        startTask?.cancel()
        startTask = nil
        startAttemptInFlight = false
        startWaiterPresent = false
    }

    /// 诊断阶梯第 3 级：系统给出的本次断开原因。
    ///
    /// 覆盖「隧道扩展根本没被系统拉起来」——扩展连写诊断文件的机会都没有，前两级俱空，
    /// 系统是唯一知情者（签名不符、配置无效、权限缺失都落在这里）。
    ///
    /// 取原错误而不是字符串：归类要看域与码（例如扩展被关掉），字符串化之后只剩文本。
    func lastDisconnectError() async -> (any Error)? {
        guard let connection = manager?.connection else { return nil }
        // 闭包**必须显式 `@Sendable`**：在 `@MainActor` 类型里就地写的闭包会继承 MainActor
        // 隔离，而 NetworkExtension 的 block 参数没标 `NS_SWIFT_SENDABLE`，于是编译零警告地
        // 装上一个「入口即断言在主执行器上」的门——系统一旦不在主队列投递就当场 trap。
        return await withCheckedContinuation { continuation in
            connection.fetchLastDisconnectError { @Sendable failure in
                continuation.resume(returning: failure)
            }
        }
    }

    /// `lastDisconnectError()` 的呈现形态：系统原因 + 本机才查得到的同 id 冲突。
    nonisolated func systemDisconnectDetail(for systemFailure: (any Error)?) -> String? {
        let reported = systemFailure.map(Self.systemDetail)
        let conflict: String? = nil
        let detail = DiagnosisDetail.join([reported, conflict])
        return detail.isEmpty ? nil : detail
    }


    /// 域与码必须进详情：本地化描述随系统语言变，只有域与码可被检索、可跨机器比对。
    ///
    /// 码还要翻成符号名——`code=12` 与 `pluginFailed` 的信息量差着一次查表，而查表要有
    /// SDK 头文件在手；用户复制走的那段诊断里没有。
    nonisolated static func systemDetail(_ failure: Error) -> String {
        let failure = failure as NSError
        let name = connectionErrorName(domain: failure.domain, code: failure.code)
        let code = name.map { "code=\(failure.code) (\($0))" } ?? "code=\(failure.code)"
        return "os reported tunnel disconnect error: \(failure.domain) \(code)"
            + " — \(failure.localizedDescription)"
    }

    /// `NEVPNConnectionError` 的符号名。其余域交给调用方原样呈现码，不臆造名字。
    nonisolated static func connectionErrorName(domain: String, code: Int) -> String? {
        guard domain == NEVPNConnectionErrorDomain,
              let error = NEVPNConnectionError(rawValue: code) else { return nil }
        switch error {
        case .overslept: return "overslept"
        case .noNetworkAvailable: return "noNetworkAvailable"
        case .unrecoverableNetworkChange: return "unrecoverableNetworkChange"
        case .configurationFailed: return "configurationFailed"
        case .serverAddressResolutionFailed: return "serverAddressResolutionFailed"
        case .serverNotResponding: return "serverNotResponding"
        case .serverDead: return "serverDead"
        case .authenticationFailed: return "authenticationFailed"
        case .clientCertificateInvalid: return "clientCertificateInvalid"
        case .clientCertificateNotYetValid: return "clientCertificateNotYetValid"
        case .clientCertificateExpired: return "clientCertificateExpired"
        case .pluginFailed: return "pluginFailed"
        case .configurationNotFound: return "configurationNotFound"
        case .pluginDisabled: return "pluginDisabled"
        case .negotiationFailed: return "negotiationFailed"
        case .serverDisconnected: return "serverDisconnected"
        case .serverCertificateInvalid: return "serverCertificateInvalid"
        case .serverCertificateNotYetValid: return "serverCertificateNotYetValid"
        case .serverCertificateExpired: return "serverCertificateExpired"
        @unknown default: return nil
        }
    }

    private func loadManager() async {
        do {
            _ = try await managerFromPreferences(.cached)
        } catch {
            logger.error("load tunnel manager failed: \(describe(error), privacy: .public)")
        }
    }

    private func startTunnel(options: TunnelStartOptionsSnapshot, generation: Int) async {
        do {
            let manager = try await loadOrCreateManager()
            try Task.checkCancellation()
            guard generation == startGeneration else { return }
            manager.isEnabled = true
            try await manager.saveToPreferences()
            try Task.checkCancellation()
            guard generation == startGeneration else { return }
            try await manager.loadFromPreferences()
            try Task.checkCancellation()
            guard generation == startGeneration else { return }
            bindManager(manager)
            // 配置与记账归属随启动 options 贯通到隧道扩展；
            // 键集取 core 的同一份，与 PacketTunnelProvider 的消费端同一来源。
            try manager.connection.startVPNTunnel(options: options.providerOptions)
            startRequestSubmitted = true
            if generation == startGeneration { startTask = nil }
        } catch is CancellationError {
            if generation == startGeneration { startTask = nil }
        } catch {
            guard generation == startGeneration else { return }
            startTask = nil
            startAttemptInFlight = false
            startFailureGeneration += 1
            // 这一沿的错误正是系统对启动的判定（`NEVPNErrorDomain code=5` 之类），诊断
            // 须带域与码：只写本地化描述的话，签名/配置/权限三类完全不同的拒绝会塌成同一句中文。
            let detail = describe(error)
            logger.error("start tunnel failed: \(detail, privacy: .public)")
            logStore.append(source: .app, level: .error, message: "start tunnel failed: \(detail)")
            if !startWaiterPresent { publishStartFailure?() }
        }
    }

    private func loadOrCreateManager() async throws -> NETunnelProviderManager {
        let manager = try await managerFromPreferences(.refresh) ?? NETunnelProviderManager()
        manager.localizedDescription = "OneBoxM"
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.extensionBundleID
        proto.serverAddress = "engine"
        proto.disconnectOnSleep = false
        applyNetworkInclusion(to: proto)
        manager.protocolConfiguration = proto
        manager.isEnabled = true
        return manager
    }

    /// 把网络包含范围的两个开关摊成 `NEVPNProtocol` 的五个属性（全仓唯一写入处）。
    ///
    /// iOS 在 split tunnel（`includeAllNetworks == false`）下把 APNs 流量排除在隧道之外，
    /// 而 `excludeAPNs` 只在 `includeAllNetworks` 为真时才被系统读取——这一对是让推送流量进入
    /// 隧道的唯一开关组合。缺了它，针对推送域名的分流规则在蜂窝网络下根本不会被执行到。
    ///
    /// 五项恒全量写入而非只写变化项：VPN 偏好由系统持久保存，漏写即残留上一次的值。
    private func applyNetworkInclusion(to proto: NEVPNProtocol) {
        let inclusion = networkInclusion()
        proto.includeAllNetworks = inclusion.includeAllNetworks
        proto.excludeAPNs = !inclusion.includeAPNs
        // 局域网恒排除：全局接管一旦把 LAN 也吞掉，路由器后台、AirDrop、投屏与打印机全断，
        // 而那从来不是「包含所有网络」的用户意图。
        proto.excludeLocalNetworks = inclusion.includeAllNetworks
        proto.excludeCellularServices = true
        proto.excludeDeviceCommunication = true
        logStore.append(
            source: .app,
            level: .info,
            message: "vpn inclusion: all=\(inclusion.includeAllNetworks) apns=\(inclusion.includeAPNs)"
        )
    }

    /// 初始化预热与首次启动共享同一个偏好请求，晚到的初始化结果不能覆盖正在使用的 session。
    private func managerFromPreferences(_ mode: ManagerPreferenceLoad) async throws -> NETunnelProviderManager? {
        if managerLoadTask == nil, managerPreferencesLoaded, mode == .cached { return manager }

        let reference = try await withCheckedThrowingContinuation { continuation in
            managerLoadWaiters.append(continuation)
            guard managerLoadTask == nil else { return }

            managerLoadGeneration += 1
            let generation = managerLoadGeneration
            managerLoadTask = Task { @MainActor [self] in
                let interval = signposter.beginInterval("LoadTunnelPreferences")
                defer { signposter.endInterval("LoadTunnelPreferences", interval) }
                do {
                    let loaded = try await NETunnelProviderManager.loadAllFromPreferences().first
                    finishManagerLoad(.success(loaded), generation: generation)
                } catch {
                    finishManagerLoad(.failure(error), generation: generation)
                }
            }
            managerLoadTimeoutTask = Task { @MainActor [weak self] in
                do {
                    try await Task.sleep(for: Self.managerLoadTimeout)
                } catch {
                    return
                }
                self?.expireManagerLoad(generation: generation)
            }
        }
        return reference.value
    }

    private func expireManagerLoad(generation: Int) {
        guard generation == managerLoadGeneration, managerLoadTask != nil else { return }
        managerLoadTask?.cancel()
        finishManagerLoad(.failure(TunnelSessionAccessError.preferencesTimedOut), generation: generation)
    }

    private func finishManagerLoad(
        _ result: Result<NETunnelProviderManager?, Error>,
        generation: Int
    ) {
        guard generation == managerLoadGeneration, managerLoadTask != nil else { return }
        managerLoadGeneration += 1
        managerLoadTask = nil
        managerLoadTimeoutTask?.cancel()
        managerLoadTimeoutTask = nil
        let waiters = managerLoadWaiters
        managerLoadWaiters.removeAll(keepingCapacity: true)

        switch result {
        case .success(let loaded):
            managerPreferencesLoaded = true
            bindManager(loaded)
            let reference = TunnelManagerReference(manager)
            for waiter in waiters { waiter.resume(returning: reference) }
        case .failure(let error):
            for waiter in waiters { waiter.resume(throwing: error) }
        }
    }

    private func bindManager(_ manager: NETunnelProviderManager?) {
        if let statusObserver {
            NotificationCenter.default.removeObserver(statusObserver)
        }
        statusObserver = nil
        self.manager = manager
        // 读**意图**而不是系统投影：停止沿会把投影压掉，跟着投影走的话设置页
        // 的 Toggle 会随每一次停止自己翻掉。
        onDemandEnabled = onDemandIntentStore.get()

        guard let connection = manager?.connection else {
            publishStatus(.invalid)
            return
        }

        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: connection,
            queue: .main
        ) { [weak self] note in
            let status = (note.object as? NEVPNConnection)?.status ?? .invalid
            MainActor.assumeIsolated {
                self?.publishStatus(status)
            }
        }
        publishStatus(connection.status)
    }

    private func publishStatus(_ status: NEVPNStatus) {
        guard status != neStatus else { return }
        neStatus = status
        signposter.emitEvent("TunnelStatusTransition")

        // `.reasserting` 计入已连接：热重载期间系统状态正是它，翻成 false 会让
        // 英雄键、快捷开关与两块走势图全部抖一下。
        let nowConnected = (status == .connected || status == .reasserting)
        // APP 源喂入点（隧道控制与服务事件）：只记录连接真相的迁移，不记录中间态噪声。
        if nowConnected != connected {
            logStore.append(
                source: .app,
                level: .info,
                message: nowConnected ? "os tunnel established" : "os tunnel disconnected"
            )
        }
        // 启动尝试终止沿：进入过 connecting 却落回 disconnected（可能途经 disconnecting）即本次启动失败。
        if status == .connecting { startAttemptInFlight = true }
        // 只要离开过断开态，系统就确实开始推进这次会话了。这一位由 `start(options:)` 清零，
        // 故它回答的恒是「本次尝试」，不会被上一段会话的历史污染。
        if status != .disconnected && status != .invalid { sessionEverLeftDisconnected = true }
        if nowConnected { startAttemptInFlight = false }
        if nowConnected && !connected { sessionStartedAt = manager?.connection.connectedDate }
        if !nowConnected { sessionStartedAt = nil }
        if (status == .disconnected || status == .invalid) && startAttemptInFlight {
            startAttemptInFlight = false
            startFailureGeneration += 1
            logStore.append(source: .app, level: .error, message: "os tunnel start attempt failed")
            if !startWaiterPresent { publishStartFailure?() }
        }
        connected = nowConnected
        // 落到断开（含冷启动时第一次读到断开）即上一个会话已结束：此刻隧道不在跑，
        // 「没有结束行」才能被当成被杀的证据。
        if status == .disconnected { sessionReport.reportLastSession() }
        requestControlRefresh()
        for continuation in statusContinuations.values {
            continuation.yield(status)
        }
    }

    /// 连接真相变了就请求系统刷新控制中心控件。
    ///
    /// 这是**加速通道而不是唯一来源**——控件的取值供给每次被系统索取时也现读，那条才保证
    /// App 不存活时仍准（其滞后是已知边界）。
    ///
    /// 按状态迁移刷新而不是只在 `connected` 翻转时刷：控件的呈现谓词把 `.connecting` 也算作开，
    /// 而那个谓词住在扩展里。与其在这边照抄一份判据（第二真相），不如在每次迁移上都请求一次
    /// ——本函数只在状态真的变了之后才被调到，一次会话也就几下。
    private func requestControlRefresh() {
        // 只有一个控件，故不按 kind 寻址——那会把控件标识变成两端各持一份的字面量。
        ControlCenter.shared.reloadAllControls()
    }

    private func providerSession() throws -> NETunnelProviderSession {
        guard let session = manager?.connection as? NETunnelProviderSession,
              session.status != .invalid,
              session.status != .disconnected else {
            throw TunnelSessionAccessError.sessionUnavailable
        }
        return session
    }
}

extension TunnelController: TunnelSessionAccess {
    func statusUpdates() -> AsyncStream<NEVPNStatus> {
        let id = UUID()
        let current = neStatus
        return AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            statusContinuations[id] = continuation
            continuation.yield(current)
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    self?.statusContinuations.removeValue(forKey: id)
                }
            }
        }
    }

    func sendProviderCommand(_ payload: Data) throws {
        let session = try providerSession()
        try session.sendProviderMessage(payload, responseHandler: nil)
    }

    func requestProviderMessage(_ payload: Data, timeout: TimeInterval) async throws -> Data {
        precondition(timeout > 0, "provider message timeout must be positive")
        let session = try providerSession()
        let interval = signposter.beginInterval("ProviderMessageRequest")
        defer { signposter.endInterval("ProviderMessageRequest", interval) }
        return try await withCheckedThrowingContinuation { continuation in
            let reply = ProviderMessageReply(continuation)
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) {
                reply.resolve(.failure(TunnelSessionAccessError.responseTimedOut))
            }
            do {
                // 同上：应答闭包不带隔离，回调线程由 NE 决定，不由本类型的隔离决定。
                try session.sendProviderMessage(payload) { @Sendable response in
                    guard let response else {
                        reply.resolve(.failure(TunnelSessionAccessError.responseMissing))
                        return
                    }
                    reply.resolve(.success(response))
                }
            } catch {
                reply.resolve(.failure(error))
            }
        }
    }
}
