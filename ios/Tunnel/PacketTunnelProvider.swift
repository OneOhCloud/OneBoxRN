import Foundation
import NetworkExtension
import Core
import WidgetKit
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.tunnel", category: "PacketTunnel")

// OS 隧道进程入口：NEPacketTunnelProvider 子类 + TunHost。构造 EngineBinding 驱动内核，
// 从中立 TunSpec 建 TUN 并 establish（读 packetFlow fd）。不 import 上游库——引擎符号只在绑定文件。
final class PacketTunnelProvider: NEPacketTunnelProvider, TunHost, @unchecked Sendable {
    /// 每次启动构造一台；未启动过时为 nil，停止/休眠即幂等空操作。
    ///
    /// **一律经 `engineLock` 访问**：`startTunnel` / `stopTunnel` / `handleAppMessage`（热重载）
    /// 由系统在不同上下文调用，彼此可并发。热重载要「停旧 → 装新」两步才完成，中间被一次
    /// `stopTunnel` 插进来就会留下一个没人停得掉的引擎。锁的粒度取整段生命周期动作而不是单次赋值——
    /// 保护赋值本身没有意义，要保护的是那两步之间的不可分割性。
    private var engine: Engine?
    private let engineLock = NSLock()

    /// 引擎生命周期的代际号（锁内读写）。**锁只保证不同时执行，不保证谁先谁后**——
    /// 一次 `stopTunnel` 抢先拿到锁停完引擎后，正在等锁的热重载照样会建一台新的起来。
    /// 停止在锁内推进代际，重载据此判定「我出发之后世界已经变了」，那才是真正的线性化。
    private var engineGeneration = 0

    /// 没有引擎时到达的睡 / 醒沿（只在 `engineLock` 内访问）：一段一行，下一次交给引擎时带出计数。
    private lazy var sleepWakeSkips = SkipLog<SleepWakeSkip>(
        stream: "provider sleep/wake",
        write: { [weak self] line in self?.writeLog(line) }
    )

    /// 在引擎生命周期锁内执行。读取类调用（pause/wake/purge）同样走这里：它们与换引擎并发时
    /// 可能拿到一个正在被拆的实例。
    private func withEngineLock<T>(_ body: () throws -> T) rethrows -> T {
        engineLock.lock()
        defer { engineLock.unlock() }
        return try body()
    }

    override func startTunnel(options: [String: NSObject]?) async throws {
        // 本函数返回即这次启动尝试有了结局，成败都要让控件重查。抛出时系统不保证再走
        // stopTunnel，控件若是这次启动的发起方就会停在「开」；成功时则是反方向——按需连接在
        // App 不存活时拉起隧道，控件会停在「关」。
        defer { requestControlRefresh() }
        let snapshot: TunnelStartOptionsSnapshot
        do {
            snapshot = try resolveStartOptions(options)
        } catch {
            let detail = describe(error)
            logger.error("start refused: \(detail, privacy: .public)")
            writeStartError(detail)
            throw error
        }
        TunnelJournalWriter.shared.beginSession("pid=\(getpid()) build=\(Self.buildVersion)")
        installUsageRecorder(profileId: snapshot.profileId)
        clearStartError()
        StartupLog.begin()
        // 阶段标记：扩展若异常终止（崩溃/被杀）就走不到写错误那步，UI 只能看到空诊断。
        // 留下最后到达的阶段，使「没有错误详情」这件事本身可诊断。
        markStartStage("engine-create")
        try withEngineLock {
            let engine = makeEngine()
            self.engine = engine
            do {
                markStartStage("engine-start")
                try engine.start(config: snapshot.config)
                logger.log("tunnel started")
                // 正常启动：清除阶段标记，残留标记即代表上次启动未走完；启动期全量日志到此为止，
                // 此后由运行期日志接手。
                clearStartStage()
                StartupLog.end()
                TunnelJournalWriter.shared.record(.sessionStarted)
                TunnelJournalWriter.shared.startMonitoring()
            } catch {
                // `localizedDescription` 对系统错误只剩一句随语言变的文本、对原生错误只剩一句
                // 「操作无法完成」的占位（诊断要带域与码）。诊断文本全仓走 core 的 `describe`。
                let detail = describe(error)
                logger.error("engine start failed: \(detail, privacy: .public)")
                writeStartError(detail)
                // 启动抛错后系统不再调 stopTunnel，结束行只能在这里写，否则会被判成「被杀」。
                TunnelJournalWriter.shared.recordNow(
                    .sessionEnd, "reason=startFailed detail=\(detail)", budget: Self.journalFlushBudget
                )
                // 启动失败即拆除并置空，不留失败实例被后续 stop/重试引用。
                engine.stop()
                self.engine = nil
                throw error
            }
        }
    }

    /// 拆除：**先把网络设置还给系统，再停引擎**，整段有硬预算。
    ///
    /// 系统给这个回调的时间有限，超时即 SIGKILL 扩展；而引擎的停止有它自己的数秒上界。同步跑完
    /// 再返回，就是拿「优雅关闭」赌一次「被杀在拆除中途」——赌输的代价不对称：被杀在撤设置之前，
    /// 设备默认路由仍指向一条已经不存在的隧道，那不是隧道断了，是整机断网。
    override func stopTunnel(with reason: NEProviderStopReason) async {
        let startedAtMillis = MonotonicClock.millis()
        logger.log("stopping, reason: \(reason.rawValue)")
        // 放在拆除开头而不是结尾。此刻系统状态已是 .disconnecting（控件映射为关），而下面
        // 整段拆除还有数百毫秒可用；放结尾就是拿这次刷新赌一场 SIGKILL。
        requestControlRefresh()
        TunnelJournalWriter.shared.recordNow(
            .sessionEnd,
            TunnelJournal.stopDetail(reason: Self.name(of: reason), code: reason.rawValue),
            budget: Self.journalFlushBudget
        )
        TunnelJournalWriter.shared.stopMonitoring()
        let stopping = detachEngine()
        let settingsCleared = clearTunnelNetworkSettings()
        let engineStopped = stopEngine(
            stopping,
            budgetMillis: TunnelTeardown.engineStopBudgetMillis(
                elapsedMillis: MonotonicClock.millis() - startedAtMillis
            )
        )
        logTeardown(
            startedAtMillis: startedAtMillis,
            outcome: TeardownOutcome(settingsCleared: settingsCleared, engineStopped: engineStopped)
        )
    }

    /// 摘下当前引擎并推进代际（都是瞬时赋值，故整段在锁内一次做完）。
    ///
    /// 摘完就不必再持锁：撤设置与停引擎都是有界等待，压在锁上会把一次并发的 `handleAppMessage`
    /// 一并卡住整个预算；而代际已经推过，迟到的热重载自行作废。
    private func detachEngine() -> Engine? {
        withEngineLock {
            // 停止沿补提交：先于引擎拆除，最后那不满一分钟的量才不会丢。
            // 在锁内做：放到锁外会被一次并发热重载插进来重新装上一个记账器，此后无人关闭。
            MonitorHub.shared.closeUsageRecorder()
            engineGeneration += 1
            let detached = engine
            engine = nil
            return detached
        }
    }

    /// 把隧道网络设置还给系统。返回是否在预算内完成——超预算即放手，不为它牺牲整段拆除。
    private func clearTunnelNetworkSettings() -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        setTunnelNetworkSettings(nil) { _ in semaphore.signal() }
        return semaphore.wait(
            timeout: .now() + .milliseconds(Int(TunnelTeardown.networkSettingsBudgetMillis))
        ) == .success
    }

    /// 停引擎：派到别的线程跑，本线程只按剩余预算等。返回它是否在预算内停完。
    private func stopEngine(_ engine: Engine?, budgetMillis: Int64) -> Bool {
        guard let engine else { return true }
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .userInitiated).async {
            engine.stop()
            semaphore.signal()
        }
        return semaphore.wait(timeout: .now() + .milliseconds(Int(budgetMillis))) == .success
    }

    /// 有界拆除的唯一可验外部效果：这一行的耗时恒在预算内。没有它就无从判定拆除是否守约。
    private func logTeardown(startedAtMillis: Int64, outcome: TeardownOutcome) {
        let elapsed = MonotonicClock.millis() - startedAtMillis
        logger.log("""
            tunnel stopped in \(elapsed, privacy: .public)ms \
            (settings cleared: \(outcome.settingsCleared ? "yes" : "timed out", privacy: .public), \
            engine stop: \(outcome.engineStopped ? "completed" : "abandoned", privacy: .public))
            """)
    }

    private struct TeardownOutcome {
        let settingsCleared: Bool
        let engineStopped: Bool
    }

    /// 记账归属为空（debug 引导配置、legacy 启动快照）即不记账，不是装配 bug。
    private func installUsageRecorder(profileId: String) {
        guard UsageHistory.isValidRecordId(profileId) else {
            MonitorHub.shared.installUsageRecorder(nil)
            // 未归属会话恒落一行诊断——缺字段的 legacy 快照与 debug 引导都走这里，
            // 二者在这一层无法区分，但「本次不记账」这件事必须可见。
            logger.log("usage recording skipped: unattributed session")
            return
        }
        MonitorHub.shared.installUsageRecorder(
            UsageRecorder(
                files: UsageRecordFiles.of(directory: AppGroupPaths.usageDirectory(), profileId: profileId),
                onDiagnostic: { message in logger.log("\(message, privacy: .public)") }
            )
        )
    }

    override func sleep(completionHandler: @escaping () -> Void) {
        TunnelJournalWriter.shared.record(.sleep)
        // 休眠沿同样补提交——设备可能就此长时间不醒，等下一分钟未必等得到。
        MonitorHub.shared.flushUsageRecorder()
        withEngineLock {
            guard let engine else {
                sleepWakeSkips.skip(.noEngine, detail: "sleep")
                return
            }
            sleepWakeSkips.delivered()
            engine.pause()
            // 熄屏是扩展确定不在数据路径的沿,顺手把引擎空闲驻留还给系统。
            engine.purgeIdleMemory()
        }
        completionHandler()
    }

    override func wake() {
        TunnelJournalWriter.shared.record(.wake)
        withEngineLock {
            guard let engine else {
                sleepWakeSkips.skip(.noEngine, detail: "wake")
                return
            }
            sleepWakeSkips.delivered()
            engine.wake()
        }
    }

    // UI → 内核的官方入口（sendProviderMessage 的对端）：只承载反向命令与快照索取，
    // 观察数据走独立的单向 datagram 通道。未知/坏消息返回 nil，不臆测语义。
    override func handleAppMessage(_ messageData: Data) async -> Data? {
        guard let command = ObservationCommandCodec.decode(messageData) else {
            logger.debug("app message discarded (undecodable)")
            return nil
        }
        switch command {
        case .selectNode(let tag):
            MonitorHub.shared.selectNode(tag: tag)
            return nil
        case .urlTest(let tag):
            MonitorHub.shared.urlTest(tag: tag)
            return nil
        case .snapshotRequest:
            let snapshot = MonitorHub.shared.snapshot()
            return ObservationSnapshotCodec.encode(ObservationSnapshot(
                traffic: snapshot.traffic,
                groups: snapshot.groups,
                running: snapshot.running
            ))
        case .reload(let id):
            return reloadEngine(id: id)
        }
    }

    /// 热重载：就地换引擎，**不结束系统 VPN 会话**。
    ///
    /// `reasserting` 是本仓对系统能给的唯一表态：Apple 只定义「重连服务端期间置它」，并不承诺
    /// 状态序列必然是 `.connected → .reasserting → .connected`。那条序列是产品要求，要在真机上验。
    ///
    /// 失败即拆到断开（不自愈、不重试）：诊断照常写 App Group，App 下次读到即弹失败弹层。
    private func reloadEngine(id: UInt64) -> Data {
        reasserting = true
        MonitorHub.shared.beginReload()
        defer {
            MonitorHub.shared.endReload()
            reasserting = false
        }
        // 上一次的启动错误必须先清：诊断阶梯第 1 级读的就是它，残留会冒充本次结局。
        clearStartError()
        // 出发时的代际：等锁期间若有一次停止跑完，代际会变，本次重载即作废（不能再起新引擎）。
        let entryGeneration = withEngineLock { engineGeneration }
        do {
            // 「停旧 → 装新」整段在锁内：中间被一次 stopTunnel 插进来就会留下一个没人停得掉的引擎。
            try withEngineLock {
                guard engineGeneration == entryGeneration else {
                    throw EngineError(token: "RELOAD_NOT_RUNNING", detail: "tunnel stopped during reload")
                }
                guard let snapshot = try loadPersistedStartOptions() else {
                    throw EngineError(token: "RELOAD_FAILED", detail: "no start options snapshot to reload from")
                }
                // 停止沿补提交：旧归属那段先落账，再换记账归属。
                MonitorHub.shared.closeUsageRecorder()
                installUsageRecorder(profileId: snapshot.profileId)
                if let running = engine {
                    // 就地换配置：引擎自己拆旧建新，隧道参数没变就不回来要 TUN，宿主全程无感。
                    markStartStage("engine-reload")
                    try running.reload(config: snapshot.config)
                } else {
                    // 引擎已不在（被引擎自身的 serviceStop 拆过）：只能新装一台。
                    markStartStage("engine-restart")
                    let restarted = makeEngine()
                    engine = restarted
                    try restarted.start(config: snapshot.config)
                }
            }
            clearStartStage()
            logger.log("tunnel reloaded")
            TunnelJournalWriter.shared.record(.reload, "id=\(id) ok")
            return publishReloadOutcome(ReloadOutcomeRecord(id: id, error: nil))
        } catch let cancelled as EngineError where cancelled.token == "RELOAD_NOT_RUNNING" {
            // **用户取消不是重载失败**：隧道已在停止途中，此处既不写诊断也不再拆一次，
            // 否则一次正常的断开会在 App 侧弹出启动失败弹层。
            logger.log("engine reload cancelled: tunnel already stopping")
            // 记账器可能已在本次重载里装上新的一台（detachEngine 在锁内把它一并关掉）。
            _ = stopEngine(detachEngine(), budgetMillis: TunnelTeardown.totalBudgetMillis)
            return publishReloadOutcome(ReloadOutcomeRecord(id: id, error: cancelled))
        } catch {
            let detail = describe(error)
            logger.error("engine reload failed: \(detail, privacy: .public)")
            TunnelJournalWriter.shared.record(.reload, "id=\(id) failed: \(detail)")
            let failure = EngineError(token: "RELOAD_FAILED", detail: detail)
            writeStartError(failure.detail ?? failure.token)
            // 失败路径必须自己收掉本次装上的记账器与引擎，不能指望「以后总会有一次系统 stop」；
            // 拆除有界——这条路跑在 handleAppMessage 上，它同样等不起数秒。
            _ = stopEngine(detachEngine(), budgetMillis: TunnelTeardown.totalBudgetMillis)
            // 硬次序：**结局先落盘 → 再拆隧道 → 最后才回话**。
            // cancelTunnelWithError 之后这条应答通道不保证还能回话，落盘那份才是 App 的对账依据；
            // 且它必须在锁外调用——系统可能就地回调 stopTunnel，那会撞上一把不可重入的锁。
            let outcome = publishReloadOutcome(ReloadOutcomeRecord(id: id, error: failure))
            TunnelJournalWriter.shared.recordNow(.cancel, "site=reload-failed", budget: Self.journalFlushBudget)
            cancelTunnelWithError(nil)
            return outcome
        }
    }

    /// 结局落 App Group 一份，并把同一件事编成应答返回。
    ///
    /// 落盘那份带 id 供认领，应答那份不带——两者共用 `ReloadOutcomeCodec`，各编各的迟早分叉，
    /// 而分叉只在失败那一拍现形。
    private func publishReloadOutcome(_ record: ReloadOutcomeRecord) -> Data {
        do {
            try ReloadOutcomeRecordCodec.encode(record)
                .write(to: AppGroupPaths.reloadOutcomeURL(), options: .atomic)
        } catch {
            // 落盘那份是 App 对账的**唯一**依据：写丢了，一次其实成功的重载会被判成失败，
            // 连同一条健康的隧道一起拆掉。此刻能做的只有留证据——应答那条路还在，且拆隧道后
            // 它不保证还能回话，故不在这里改变结局。
            logger.error("reload outcome write failed: \(describe(error), privacy: .public)")
        }
        return record.error.map(ReloadOutcomeCodec.encodeFailure) ?? ReloadOutcomeCodec.encodeSuccess()
    }

    // MARK: - TunHost

    func openTun(_ spec: TunSpec) throws -> Int32 {
        do {
            try applyTunSettings(spec)
        } catch {
            // 动态更新失败时旧路由可能仍覆盖新的本地网段，不能保留这条隧道。
            TunnelJournalWriter.shared.recordNow(
                .cancel, "site=tun-settings detail=\(describe(error))", budget: Self.journalFlushBudget
            )
            cancelTunnelWithError(error)
            throw error
        }
        // 新 iOS 上 packetFlow 私有键路径可能取不到 fd：按契约返回 -1，
        // 由绑定层用引擎辅助函数回落获取（参照 OneBoxRN 的双路径）。
        guard let fd = packetFlow.value(forKeyPath: "socket.fileDescriptor") as? Int32 else {
            logger.log("packetFlow fd unavailable, delegating to binding fallback")
            return -1
        }
        logger.log("TUN settings applied fd=\(fd)")
        return fd
    }

    private func applyTunSettings(_ spec: TunSpec) throws {
        try applySettings(try buildSettings(spec))
    }

    private func applySettings(_ settings: NEPacketTunnelNetworkSettings) throws {
        let box = ApplyResult()
        let semaphore = DispatchSemaphore(value: 0)
        setTunnelNetworkSettings(settings) { error in
            box.error = error
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + .seconds(5)) == .success else {
            throw EngineError(
                token: "TUN_SETTINGS_TIMEOUT",
                detail: "setTunnelNetworkSettings did not complete within 5 seconds"
            )
        }
        if let error = box.error {
            // 包成契约错误再过 gomobile 桥：携 NE 域/码/描述，真因不因桥接丢失。
            let ns = error as NSError
            throw EngineError(
                token: "TUN_SETTINGS_REJECTED",
                detail: "\(ns.domain) code=\(ns.code): \(ns.localizedDescription)"
            )
        }
    }

    // iOS NE 自动把扩展出站 socket 置于隧道之外，无需 protect；保留以满足 TunHost 契约对称。
    func protect(_ fd: Int32) -> Bool { true }

    // 统一日志的 debug 档默认不持久化、Console 亦默认不显示；无条件按 debug 写入会让
    // 引擎的 warn 及以上在设备上不可见，而扩展异常终止后这些恰恰是唯一还取得到的行。
    // 档位按 LogLevel 全序映射；token 前缀保留，使被合并的两档仍可区分。
    func writeLog(_ line: LogLine) {
        // 启动期同时落盘：观察通道要引擎起来之后才建，启动失败时 os_log 之外无处留痕。
        StartupLog.append(line)
        if line.level >= .warn {
            TunnelJournalWriter.shared.record(.engine, "[\(line.level.token)] \(line.message)")
        }
        let level = line.level.token
        let message = line.message
        switch line.level {
        case .trace, .debug:
            logger.debug("[\(level, privacy: .public)] \(message, privacy: .public)")
        case .info:
            logger.info("[\(level, privacy: .public)] \(message, privacy: .public)")
        case .warn:
            logger.warning("[\(level, privacy: .public)] \(message, privacy: .public)")
        case .error:
            logger.error("[\(level, privacy: .public)] \(message, privacy: .public)")
        case .fatal, .panic:
            logger.critical("[\(level, privacy: .public)] \(message, privacy: .public)")
        }
    }

    // MARK: - TunSpec → NE 网络设置

    /// 隧道没有远端：本地引擎即对端。
    private static let tunnelRemoteAddress = "127.0.0.1"

    private func buildSettings(_ spec: TunSpec) throws -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: Self.tunnelRemoteAddress)
        if spec.autoRoute {
            // iOS 同时只允许一条 packet-tunnel VPN，没有别的隧道网卡的网段声明需要避让，排除项原样下发。
            let (inet4Excludes, inet6Excludes) = (spec.inet4RouteExcludes, spec.inet6RouteExcludes)
            settings.mtu = NSNumber(value: spec.mtu)
            if !spec.dnsServer.isEmpty {
                let dns = NEDNSSettings(servers: [spec.dnsServer])
                dns.matchDomains = [""]
                dns.matchDomainsNoSearch = true
                settings.dnsSettings = dns
            }
            if !spec.inet4Addresses.isEmpty {
                let ipv4 = NEIPv4Settings(
                    addresses: spec.inet4Addresses.map(\.address),
                    subnetMasks: spec.inet4Addresses.map { Self.ipv4Mask($0.prefix) }
                )
                ipv4.includedRoutes = spec.inet4Routes.isEmpty
                    ? [NEIPv4Route.default()]
                    : try TunnelDnsRoute.including(dnsServer: spec.dnsServer, in: spec.inet4Routes, excluding: inet4Excludes).map {
                        NEIPv4Route(destinationAddress: $0.address, subnetMask: Self.ipv4Mask($0.prefix))
                    }
                ipv4.excludedRoutes = inet4Excludes.map {
                    NEIPv4Route(destinationAddress: $0.address, subnetMask: Self.ipv4Mask($0.prefix))
                }
                // 接管范围进日志。included 数千条（即不是默认路由）会让扩展自身发往这些网段的出站全部失败；excluded
                // 数千条则常驻在 nesessionmanager / configd 里，把它们推过内存高水位（见 TunExclusionPolicy）。
                // 而排除项一旦被折叠成正向网段，分流还会从系统层消失，表面却一切正常
                // （流量改由引擎按规则分，只是全都先进了隧道）。两个数一起记，无需复现即可核对。
                logger.log(
                    """
                    tunnel scope: inet4 included=\(ipv4.includedRoutes?.count ?? 0) \
                    excluded=\(ipv4.excludedRoutes?.count ?? 0) \
                    default=\(spec.inet4Routes.contains { $0.prefix == 0 })
                    """
                )
                settings.ipv4Settings = ipv4
            }
            if !spec.inet6Addresses.isEmpty {
                let ipv6 = NEIPv6Settings(
                    addresses: spec.inet6Addresses.map(\.address),
                    networkPrefixLengths: spec.inet6Addresses.map { NSNumber(value: $0.prefix) }
                )
                ipv6.includedRoutes = spec.inet6Routes.isEmpty
                    ? [NEIPv6Route.default()]
                    : try TunnelDnsRoute.including(dnsServer: spec.dnsServer, in: spec.inet6Routes, excluding: inet6Excludes).map {
                        NEIPv6Route(destinationAddress: $0.address, networkPrefixLength: NSNumber(value: $0.prefix))
                    }
                ipv6.excludedRoutes = inet6Excludes.map {
                    NEIPv6Route(destinationAddress: $0.address, networkPrefixLength: NSNumber(value: $0.prefix))
                }
                logger.log(
                    """
                    tunnel scope: inet6 included=\(ipv6.includedRoutes?.count ?? 0) \
                    excluded=\(ipv6.excludedRoutes?.count ?? 0)
                    """
                )
                settings.ipv6Settings = ipv6
            }
        }
        if spec.httpProxyEnabled {
            let proxy = NEProxySettings()
            let server = NEProxyServer(address: spec.httpProxyServer, port: Int(spec.httpProxyPort))
            proxy.httpServer = server
            proxy.httpsServer = server
            proxy.httpEnabled = true
            proxy.httpsEnabled = true
            settings.proxySettings = proxy
        }
        return settings
    }

    private static func ipv4Mask(_ prefix: Int32) -> String {
        let bits = max(0, min(32, Int(prefix)))
        let mask: UInt32 = bits == 0 ? 0 : (~UInt32(0) << (32 - bits))
        return "\((mask >> 24) & 0xff).\((mask >> 16) & 0xff).\((mask >> 8) & 0xff).\(mask & 0xff)"
    }

    // MARK: - 生命周期辅助

    /// 一行关键日志最多等这么久落盘：拆除与取消路径都有自己的时间预算，日志只能分到一小份。
    private static let journalFlushBudget: DispatchTimeInterval = .milliseconds(200)

    private static let buildVersion =
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"

    /// 停止原因的可读名：日志与 App 侧判定读的是名字，裸数字要查表才懂。
    private static func name(of reason: NEProviderStopReason) -> String {
        switch reason {
        case .none: "none"
        case .userInitiated: TunnelJournal.userStopReason
        case .providerFailed: "providerFailed"
        case .noNetworkAvailable: "noNetworkAvailable"
        case .unrecoverableNetworkChange: "unrecoverableNetworkChange"
        case .providerDisabled: "providerDisabled"
        case .authenticationCanceled: "authenticationCanceled"
        case .configurationFailed: "configurationFailed"
        case .idleTimeout: "idleTimeout"
        case .configurationDisabled: "configurationDisabled"
        case .configurationRemoved: "configurationRemoved"
        case .superceded: "superceded"
        case .userLogout: "userLogout"
        case .userSwitch: "userSwitch"
        case .connectionFailed: "connectionFailed"
        case .sleep: "sleep"
        case .appUpdate: "appUpdate"
        case .internalError: "internalError"
        @unknown default: "unknown"
        }
    }

    /// 请求系统重查控制中心控件的取值。
    ///
    /// App 侧也有一条同样的请求，但它只在 App 活着时发得出——而隧道停止最常发生在 App 不在的
    /// 时候（系统设置里关、按需断开、引擎自停、启动失败）。那一刻只有本进程知道这件事，且它
    /// 正要死，所以这一跳没人能代劳。
    ///
    /// 不持有状态：这里只是让系统再去问一次 NEVPNStatus，控件的取值路径不变。
    private func requestControlRefresh() {
        // 留痕：请求本身没有返回值，控件那边只看得到「被索取了」。两边都不落日志的话，
        // 「系统自己想起来重查」与「本进程要求它重查」在事后无法区分；判读靠这一行与控件侧
        // Gateway 那行的先后关系。
        logger.log("control refresh requested")
        ControlCenter.shared.reloadAllControls()
    }


    private func makeEngine() -> Engine {
        EngineBinding(tunHost: self, onServiceStop: { [weak self] in self?.stopByEngine() })
    }

    /// 引擎自己要求停止：同样有界拆除——这条路跑在引擎的回调线程上，
    /// 让它无界地等自己停完，`cancelTunnelWithError` 就会被推迟同样久。
    private func stopByEngine() {
        let stopping = detachEngine()
        _ = stopEngine(stopping, budgetMillis: TunnelTeardown.totalBudgetMillis)
        // 网络设置的撤销交给随之而来的 stopTunnel（那时引擎已摘、这里不重复一次）。
        TunnelJournalWriter.shared.recordNow(.cancel, "site=engine-requested-stop", budget: Self.journalFlushBudget)
        cancelTunnelWithError(nil)
    }

    private func resolveStartOptions(_ options: [String: NSObject]?) throws -> TunnelStartOptionsSnapshot {
        if options?[TunnelStartOptionsSnapshot.configKey] != nil {
            let snapshot = try TunnelStartOptionsSnapshot(options: options)
            try persistStartOptions(snapshot)
            return snapshot
        }
        if let recovered = try loadPersistedStartOptions() {
            logger.log("start options recovered from App Group snapshot")
            return recovered
        }
        throw EngineError(token: "START_OPTIONS_MISSING", detail: "missing config")
    }

    private func persistStartOptions(_ snapshot: TunnelStartOptionsSnapshot) throws {
        let url = startOptionsURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try snapshot.encoded().write(to: url, options: .atomic)
    }

    private func loadPersistedStartOptions() throws -> TunnelStartOptionsSnapshot? {
        let url = startOptionsURL()
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try TunnelStartOptionsSnapshot.decode(Data(contentsOf: url))
    }

    private func startOptionsURL() -> URL {
        AppGroupPaths.startOptionsURL()
    }

    /// 诊断阶梯第 1 级的写端。写不进去即整级诊断消失，故必须留痕。
    ///
    /// 不崩：此刻正走在启动失败的收口上，崩了会把「引擎起不来」变成「扩展崩了」，把仅剩的
    /// 那点线索也换掉。观察面故障不升级为数据面故障，但也不许不留证据。
    private func writeStartError(_ detail: String) {
        let url = AppGroupPaths.startErrorURL()
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try detail.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            logger.error("start diagnostic write failed: \(describe(error), privacy: .public)")
        }
    }

    /// 启动/重载入口清上一次的残留：清不掉的话残留会冒充本次结局（诊断阶梯第 1 级会读到旧错误）。
    private func clearStartError() {
        do {
            try "".write(to: AppGroupPaths.startErrorURL(), atomically: true, encoding: .utf8)
        } catch {
            logger.error("start diagnostic clear failed: \(describe(error), privacy: .public)")
        }
    }

    private func markStartStage(_ stage: String) {
        StartStage.mark(stage)
    }

    private func clearStartStage() {
        StartStage.clear()
    }
}

// setTunnelNetworkSettings 完成回调的结果盒（跨线程写入 + 信号量同步读取）。
private final class ApplyResult: @unchecked Sendable {
    var error: Error?
}

private enum SleepWakeSkip: String, SkipCause {
    case noEngine = "no-engine"

    var token: String { rawValue }
    var level: LogLevel { .debug }
}
