import Foundation
import NetworkExtension
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "MonitorBinding")
private let signposter = OSSignposter(logger: logger)

// UI 进程侧 Monitor：连接阶段与启动错误来自内核无关的权威来源（NEVPNStatus + App Group
// start_error.txt），观察桥只搬流量/分组/日志；反向命令走官方 sendProviderMessage。
// 不 import 任何引擎符号——App 进程不加载引擎，引擎只在隧道扩展里跑。
final class MonitorBinding: NSObject, Monitor, @unchecked Sendable {
    // 回调事务覆盖 handler 与状态副作用；固定锁序为 callbackLock → channelLock → lock。
    private let callbackLock = NSRecursiveLock()
    /// 通道构造整体串行：「检查 → 构造 → 落位」不能被另一次构造插进来——
    /// 两个并发构造会各自建端点，后落位的那个把先落位的挤成孤儿。
    private let channelLock = NSRecursiveLock()
    private let lock = NSLock()
    private let sessionAccess: any TunnelSessionAccess
    private var callbackDepth = 0
    private var receiversAwaitingClose: [ObservationReceiver] = []
    private var handler: MonitorHandler?
    private var status: EngineStatus = .stopped
    private var receiver: ObservationReceiver?
    /// 通道代际，与承载 OS 状态观察的 `statusGeneration` **分开**：
    /// 终止回执据此分辨「当前通道」与「一条晚到的旧回执」，否则旧回执会清掉刚装好的新通道。
    private var receiverGeneration: UInt64 = 0
    /// 全局至多一条重建任务；`.stopped`、摘 handler、代际变化时取消。
    private var rebuildTask: Task<Void, Never>?
    private var rebuildAttempt = 0
    /// 端点被占用只记一次，避免第二实例长期存活时刷屏。
    private var reportedEndpointBusy = false
    /// 通道健康度：本层是它的唯一产地，变化即推给消费方。
    private var health = ObservationHealth.idle
    private var statusTask: Task<Void, Never>?
    private var statusGeneration: UInt64 = 0
    private var snapshotTask: Task<Void, Never>?
    private var snapshotGeneration: UInt64 = 0
    private var snapshotInFlight = false
    private var snapshotRefreshPending = false
    /// 挂起闸门的本地镜像：闸门关着时不建通道——本进程可被挂起，而挂起时
    /// 手里攥着 App Group 容器内的锁会被系统当场杀掉。
    private var suspensionGateOpen: Bool

    /// 通道的建立 / 失效 / 重建要落 `APP` 源日志，使「`ENGINE` 段为什么不动了」在**应用内**
    /// 就有答案。本类不认识 `LogStore`（那是 App 装配层的东西），只经这个出口把事件报出去。
    private let onDiagnostic: @Sendable (LogLevel, String) -> Void

    /// 端点、分组快照与启动错误的出处（共享容器）。
    private let channelSource: ObservationChannelSource

    init(
        sessionAccess: any TunnelSessionAccess,
        suspensionGate: ObservationSuspensionGate,
        channelSource: ObservationChannelSource = .current,
        onDiagnostic: @escaping @Sendable (LogLevel, String) -> Void = { _, _ in }
    ) {
        self.sessionAccess = sessionAccess
        self.channelSource = channelSource
        self.onDiagnostic = onDiagnostic
        // 先给个保守初值再注册：`addConsumer` 一步完成「读当前值 + 订阅后续」，
        // 分两步做的话两步之间的翻转会丢，而丢掉的若是「关」就等于没设防。
        suspensionGateOpen = false
        super.init()
        suspensionGateOpen = suspensionGate.addConsumer { [weak self] open in
            self?.suspensionGateChanged(open ? .open : .close)
        }
    }

    // MARK: - Monitor

    func setHandler(_ handler: MonitorHandler) {
        beginCallbackTransaction()
        lock.lock()
        self.handler = handler
        let current = status
        statusGeneration &+= 1
        let generation = statusGeneration
        // **先拆旧通道再挂新 handler**：`statusGeneration` 一推进，旧通道捕获的代际就永久对不上，
        // 它投递的每一帧都会被 dispatch 的门控静默丢弃；而 `openChannel` 又因 `receiver != nil`
        // 不会重开——二次挂载就此让通道永久静音。留着它比没有更坏。
        let outgoing = takeChannelLocked()
        let outgoingRebuild = rebuildTask
        rebuildTask = nil
        lock.unlock()
        // 代际一变，在途重建就属于上一代：留着它最多空转一个退避周期（可达 30 秒）才因代际
        // 不符自行放弃，那期间的日志与健康度都在讲上一代的事。
        outgoingRebuild?.cancel()
        enqueueReceiverForClose(outgoing)?.close()
        // 契约不变量：挂载首个 onStatus 即当前状态。
        handler.onStatus(current)
        // 挂载同样推一次初始健康度：换绑定（切核）时消费方是同一个对象，它手里还攥着**上一条**
        // 绑定的帧时刻——不清掉，新通道首帧到达前的十几秒里页面显示的是上一条绑定的读数。
        lock.lock()
        health = .idle
        lock.unlock()
        handler.onObservationHealth(.idle)
        // 引擎可能已在运行（app 重启后重挂）：开通道并索取一次快照，免干等下一次推送。
        if current == .started, isStatusObservationCurrent(generation) {
            openChannel(statusGeneration: generation)
            requestSnapshot(statusGeneration: generation)
        }
        endCallbackTransaction()
        observeStatus(generation: generation)
    }

    func currentStatus() -> EngineStatus {
        lock.lock()
        defer { lock.unlock() }
        return status
    }

    // 启动错误与内核无关：provider 无论哪个核都写同一份 App Group 文件（与默认核同源）。
    func lastError() throws -> EngineError? {
        try StartDiagnostic.read(files: channelSource.files)
    }

    func selectNode(tag: String) {
        send(.selectNode(tag: tag))
    }

    func urlTest(tag: String) {
        send(.urlTest(tag: tag))
    }

    // 观察通道属 UI 进程，停它不影响扩展进程里的内核；故与 close 同体。
    func detachHandler() {
        callbackLock.lock()
        lock.lock()
        handler = nil
        let channel = takeChannelLocked()
        let statusTask = statusTask
        self.statusTask = nil
        statusGeneration &+= 1
        let snapshotTask = snapshotTask
        snapshotRefreshPending = false
        let rebuildTask = rebuildTask
        self.rebuildTask = nil
        lock.unlock()
        let closesImmediately = enqueueReceiverForClose(channel)
        callbackLock.unlock()
        statusTask?.cancel()
        snapshotTask?.cancel()
        rebuildTask?.cancel()
        closesImmediately?.close()
    }

    /// 摘下当前通道并作废其代际（须持 `lock`）。
    ///
    /// 代际一推进，那条通道之后的任何终止/断流回执都对不上号而被丢弃——这正是所要的：
    /// 已经被我们主动换掉的通道，它的身后事不该再驱动一次重建。
    private func takeChannelLocked() -> ObservationReceiver? {
        let channel = receiver
        receiver = nil
        receiverGeneration &+= 1
        // **不**在这里复位退避：摘通道是「又失败了一次」，不是「成功了」。在这里复位会让
        // 一条能 bind 却始终收不到帧的坏通道每 15 秒原地重建一次，退避阶梯永远走不出第一级。
        // 复位只发生在真的收到帧时（见 dispatch）与会话结束时（cancelRebuild）。
        return channel
    }

    func close() {
        // 契约保证 close 后不再有回调：先摘 handler，再停观察通道。
        detachHandler()
    }

    // MARK: - OS VPN 状态观察（连接阶段唯一权威，与默认核同源）

    private func observeStatus(generation: UInt64) {
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            for await neStatus in sessionAccess.statusUpdates() {
                guard !Task.isCancelled, isStatusObservationCurrent(generation) else { return }
                onNEStatus(neStatus, generation: generation)
            }
        }
        lock.lock()
        if statusGeneration == generation, handler != nil {
            statusTask?.cancel()
            statusTask = task
            lock.unlock()
        } else {
            lock.unlock()
            task.cancel()
        }
    }

    private func isStatusObservationCurrent(_ generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return statusGeneration == generation && handler != nil
    }

    private func onNEStatus(_ ne: NEVPNStatus, generation: UInt64) {
        let next: EngineStatus
        switch ne {
        // `.reasserting` 归「已连接」，与 `TunnelController` 同判据：算作 `.starting` 的话，投递门控
        // 会在整个热重载/重连窗口内静默丢弃全部帧，页面显示「已连接 + 陈旧数字」。
        // 收紧映射而不是放宽投递门控：放宽会把首次 `.connecting` 与 `.disconnecting` 的帧也放进来。
        case .connected, .reasserting: next = .started
        case .connecting: next = .starting
        case .disconnecting: next = .stopping
        // 同 `MonitorBinding`：`NEVPNStatus` 非 frozen，已知成员列全 + `@unknown default:`，
        // 新系统加状态时编译器会警告到这一行。
        case .invalid, .disconnected: next = .stopped
        @unknown default: next = .stopped
        }
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        guard statusGeneration == generation, let handler, next != status else {
            lock.unlock()
            return
        }
        status = next
        lock.unlock()
        handler.onStatus(next)
        guard isStatusObservationCurrent(generation) else { return }
        switch next {
        case .started:
            openChannel(statusGeneration: generation)
            requestSnapshot(statusGeneration: generation)
        case .stopped:
            cancelSnapshot()
            cancelRebuild()
            enqueueReceiverForClose(removeChannel())
            // 会话结束即归零：重建计数记的是「本次会话断过几次」，跨会话累加会谎报。
            publishHealth { _ in .idle }
        // **列全而不写 `default:`**：同 `MonitorBinding`，`EngineStatus` 是自有枚举。
        case .starting, .stopping:
            break
        }
    }

    // MARK: - 观察通道

    /// 建通道。整段在 `channelLock` 内：「检查 → 构造 → 落位」若被另一次构造插进来,
    /// 两条都会各自建端点,后落位的那个把先落位的挤成孤儿。
    /// - Returns: 本次是否真的装上了通道。重建路径据此决定要不要补快照——通道没开成就发快照
    ///   只是白发一次 provider 消息（且端点归别人时，本实例本就不该有观察数据）。
    @discardableResult
    private func openChannel(statusGeneration expectedStatusGeneration: UInt64) -> Bool {
        // 健康度发布留在 `channelLock` **之外**：`publishHealth` 要取 `callbackLock`，在
        // channelLock 内取它就成了 channelLock → callbackLock，与既定锁序 callbackLock →
        // channelLock → lock 正好相反。今天它靠「每个调用点都已持有可重入的 callbackLock」
        // 侥幸不死锁，那是约定而非结构保证——把它挪出来，锁序才真的是单向的。
        switch installChannel(statusGeneration: expectedStatusGeneration) {
        case .opened:
            publishHealth { $0.with(endpoint: .bound).with(stalled: false) }
            return true
        case .failed(let endpoint):
            publishHealth { $0.with(endpoint: endpoint) }
            scheduleRebuild(statusGeneration: expectedStatusGeneration)
            return false
        case .skipped:
            return false
        }
    }

    private enum ChannelOpenOutcome {
        case opened
        case failed(endpoint: ObservationHealth.Endpoint)
        /// 前置不成立（已有通道 / 挂起闸门关着 / 代际过期 / 未连接 / 无 handler）——
        /// 不是失败，不该触发重建。
        case skipped
    }

    // MARK: - 挂起闸门

    private func suspensionGateChanged(_ transition: GateTransition) {
        if transition == .open {
            resumeAfterSuspension()
        } else {
            surrenderEndpointForSuspension()
        }
    }

    /// 进程即将可被挂起：把端点整个交还。
    ///
    /// **取消重建不可省**：退避阶梯的任务在挂起前的窗口里仍会被调度，只关通道不取消它，
    /// 锁会被自己抢回去——那时崩溃照旧，只是晚了几秒。
    private func surrenderEndpointForSuspension() {
        callbackLock.lock()
        lock.lock()
        suspensionGateOpen = false
        let channel = takeChannelLocked()
        lock.unlock()
        let closesImmediately = enqueueReceiverForClose(channel)
        callbackLock.unlock()
        cancelSnapshot()
        cancelRebuild()
        // `close()` 返回即代表路径已摘名、锁已解开，故这一步做完就可以安全挂起。
        closesImmediately?.close()

        guard channel != nil else { return }
        // 交还是有意动作，不是失效：不走终止回调、不计重建次数，诊断记 info。
        publishHealth { $0.with(endpoint: .absent).with(stalled: true) }
        logger.log("observation endpoint surrendered before suspension")
        onDiagnostic(.info, "observation endpoint surrendered before suspension")
    }

    /// 回到前台：与「相位进入已连接」那条沿同构，不新增第二条重建通路。
    private func resumeAfterSuspension() {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        suspensionGateOpen = true
        let generation = statusGeneration
        let resumable = status == .started && handler != nil
        lock.unlock()
        guard resumable else { return }
        openChannel(statusGeneration: generation)
        requestSnapshot(statusGeneration: generation)
    }

    /// 建通道。整段在 `channelLock` 内：「检查 → 构造 → 落位」若被另一次构造插进来,
    /// 两条都会各自建端点,后落位的那个把先落位的挤成孤儿。
    private func installChannel(statusGeneration expectedStatusGeneration: UInt64) -> ChannelOpenOutcome {
        channelLock.lock()
        defer { channelLock.unlock() }

        lock.lock()
        guard receiver == nil,
              suspensionGateOpen,
              statusGeneration == expectedStatusGeneration,
              status == .started,
              handler != nil else {
            lock.unlock()
            return .skipped
        }
        receiverGeneration &+= 1
        let generation = receiverGeneration
        lock.unlock()

        let channel: ObservationReceiver
        do {
            let files = channelSource.files
            channel = try ObservationReceiver(
                endpoint: try channelSource.openEndpoint(),
                readSnapshot: { try files.read(.groupsSnapshot) },
                generation: generation,
                onFrame: { [weak self] frame in
                    self?.dispatch(frame, statusGeneration: expectedStatusGeneration)
                },
                onGroups: { [weak self] groups in
                    self?.dispatch(groups: groups, statusGeneration: expectedStatusGeneration)
                },
                onStale: { [weak self] stalled, channelGeneration in
                    self?.onChannelStalled(stalled ? .stalled : .flowing, generation: channelGeneration)
                },
                onTerminated: { [weak self] reason, channelGeneration in
                    self?.onChannelTerminated(reason, generation: channelGeneration)
                }
            )
        } catch {
            reportOpenFailure(error)
            return .failed(endpoint: Self.isEndpointBusy(error) ? .busy : .absent)
        }

        lock.lock()
        let remainsCurrent = receiver == nil
            && receiverGeneration == generation
            && statusGeneration == expectedStatusGeneration
            && status == .started
            && handler != nil
        if remainsCurrent {
            receiver = channel
            reportedEndpointBusy = false
            lock.unlock()
            logger.log("observation channel opened (generation \(generation, privacy: .public))")
            onDiagnostic(.info, "observation channel opened")
            return .opened
        }
        lock.unlock()
        // 这一条刚构造出来、一次回调都没投递过，故**不进**回调事务的延迟关闭队列，直接关：
        // 队列的意义是「别在回调在飞时拆掉它」，对它不适用；而它持着端点所有权锁，
        // 延迟释放会把紧接着的下一次重建挡在自己外面。
        channel.close()
        return .skipped
    }

    private static func isEndpointBusy(_ error: Error) -> Bool {
        if case ObservationEndpointFailure.busy = error { return true }
        return false
    }

    /// 端点被另一个活实例占着是**预期结局**，故只记一次；其余失败逐次记。
    private func reportOpenFailure(_ error: Error) {
        if Self.isEndpointBusy(error) {
            lock.lock()
            let alreadyReported = reportedEndpointBusy
            reportedEndpointBusy = true
            lock.unlock()
            guard !alreadyReported else { return }
        }
        logger.error("observation channel open failed: \(String(describing: error), privacy: .public)")
        onDiagnostic(.warn, "observation channel open failed: \(String(describing: error))")
    }

    private func removeChannel() -> ObservationReceiver? {
        lock.lock()
        defer { lock.unlock() }
        return takeChannelLocked()
    }

    // MARK: - 失效恢复

    /// 退避阶梯（秒）：失窃后**先立即试一次**——端点多半已随抢占者退出而空出来。
    /// 之后逐级拉开，上限 30 s，避免端点被别的活实例长期占用时形成重建风暴。
    private static let rebuildBackoffSeconds: [Double] = [0, 1, 2, 4, 8, 16, 30]

    /// 通道非自愿终止：读线程已自行回收 fd / 端点路径 / 所有权锁，这里只摘引用并重建。
    private func onChannelTerminated(_ reason: ObservationChannelTermination, generation: UInt64) {
        Task { @MainActor [weak self] in
            guard let self, let expected = retireTerminatedChannel(generation: generation) else { return }
            logger.error("observation channel lost, rebuilding: \(reason.detail, privacy: .public)")
            onDiagnostic(.warn, "observation channel lost, rebuilding: \(reason.detail)")
            // 同时置断流：只改 endpoint 的话，若最后一帧还不满 15 秒，本次推送重算仍得 fresh，
            // 而其后不再有新值发射——第 15 秒永远不会触发 UI，页面继续显示旧数字。
            publishHealth { $0.with(endpoint: .absent).with(stalled: true).countingRebuild() }
            scheduleRebuild(statusGeneration: expected)
        }
    }

    /// 加锁段整段收进同步方法：`NSLock` 不可在异步上下文里持有（跨 await 会换线程）。
    ///
    /// - Returns: 当前 `statusGeneration`；nil = 这是一条晚到的旧回执（我们早已换掉那条通道），
    ///   它不该驱动任何重建。
    private func retireTerminatedChannel(generation: UInt64) -> UInt64? {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        defer { lock.unlock() }
        guard receiverGeneration == generation, status == .started, handler != nil else { return nil }
        receiver = nil
        // 失窃/致命错之后重新从阶梯起点开始：这不是「又一次失败」，是一个新的恢复周期。
        rebuildAttempt = 0
        return statusGeneration
    }

    /// 断流：先把状态推给消费方让呈现层表态，索一次快照（引擎若还活着，快照立刻
    /// 把读数补回来），**然后拆掉这条通道重建**。
    ///
    /// 断流不等于端点坏了，但通道在位却十五秒不投递，对用户与端点丢了是同一件事；重建很便宜，
    /// 也让「正在重连监控通道」那句文案成立。
    private func onChannelStalled(_ state: ChannelFlowState, generation: UInt64) {
        Task { @MainActor [weak self] in
            guard let self, let expected = publishStalled(state, generation: generation) else { return }
            guard state == .stalled else { return }
            requestSnapshot(statusGeneration: expected)
            guard let retired = retireChannelForRebuild(generation: generation) else { return }
            retired.channel?.close()
            logger.error("observation channel stalled, rebuilding")
            onDiagnostic(.warn, "observation channel stalled, rebuilding")
            publishHealth { $0.with(endpoint: .absent).countingRebuild() }
            scheduleRebuild(statusGeneration: retired.statusGeneration)
        }
    }

    /// 摘下当前通道以便重建（断流路径专用：读线程还活着，故由调用方在锁外关它）。
    ///
    /// - Returns: nil = 代际已变或已不在运行——这条断流回执属于上一代，不该驱动重建。
    private func retireChannelForRebuild(
        generation: UInt64
    ) -> (channel: ObservationReceiver?, statusGeneration: UInt64)? {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        defer { lock.unlock() }
        guard receiverGeneration == generation, status == .started, handler != nil else { return nil }
        // takeChannelLocked 顺带把代际推进，故这条通道随后的终止回执不会再触发第二次重建。
        return (takeChannelLocked(), statusGeneration)
    }

    private func publishStalled(_ state: ChannelFlowState, generation: UInt64) -> UInt64? {
        lock.lock()
        guard receiverGeneration == generation, status == .started, handler != nil else {
            lock.unlock()
            return nil
        }
        let expected = statusGeneration
        lock.unlock()
        publishHealth { $0.with(stalled: state == .stalled) }
        return expected
    }

    private enum ChannelFlowState {
        case flowing
        case stalled
    }

    /// 健康度变化的唯一出口：值没变就不推（避免 1 Hz 的无效重算）；回调恒在锁外触发
    /// ——消费方会 hop 到 MainActor，持锁调用等于把本层的锁借给它的调度。
    private func publishHealth(_ transform: (ObservationHealth) -> ObservationHealth) {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        let updated = transform(health)
        guard updated != health, let handler else {
            health = updated
            lock.unlock()
            return
        }
        health = updated
        lock.unlock()
        handler.onObservationHealth(updated)
    }

    private func scheduleRebuild(statusGeneration expectedStatusGeneration: UInt64) {
        lock.lock()
        guard statusGeneration == expectedStatusGeneration, status == .started, handler != nil else {
            lock.unlock()
            return
        }
        let step = min(rebuildAttempt, Self.rebuildBackoffSeconds.count - 1)
        rebuildAttempt += 1
        // 抖动：多个实例同时等同一个端点时，不要在同一毫秒一起扑上去。
        let delay = Self.rebuildBackoffSeconds[step] * Double.random(in: 0.8...1.2)
        let previous = rebuildTask
        let task = Task { @MainActor [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled, let self else { return }
            beginCallbackTransaction()
            // 只有真的装上通道才补快照：开不成时发快照既拿不到后续帧，也会在端点长期被占用
            // 期间按退避节奏反复打扰扩展进程。
            if openChannel(statusGeneration: expectedStatusGeneration) {
                requestSnapshot(statusGeneration: expectedStatusGeneration)
            }
            endCallbackTransaction()
        }
        rebuildTask = task
        lock.unlock()
        previous?.cancel()
    }

    private func cancelRebuild() {
        lock.lock()
        let task = rebuildTask
        rebuildTask = nil
        rebuildAttempt = 0
        reportedEndpointBusy = false
        lock.unlock()
        task?.cancel()
    }

    private func dispatch(_ frame: ObservationFrame, statusGeneration expectedStatusGeneration: UInt64) {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        guard statusGeneration == expectedStatusGeneration,
              status == .started,
              let handler else {
            lock.unlock()
            return
        }
        // 退避在**收到帧**时复位，不在 bind 成功时复位：能 bind 却始终收不到帧的坏通道
        // 会一直回到阶梯起点，退避就等于没有。
        rebuildAttempt = 0
        lock.unlock()
        switch frame {
        case .traffic(let traffic): handler.onTraffic(traffic)
        case .log(let line): handler.onLog(line)
        case .groupsInvalidation: break // 由 onGroups 回调承接
        case .sessionStats(let stats): (handler as? SessionStatsHandler)?.onSessionStats(stats)
        }
    }

    private func dispatch(groups: [NodeGroup], statusGeneration expectedStatusGeneration: UInt64) {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        guard statusGeneration == expectedStatusGeneration,
              status == .started,
              let handler else {
            lock.unlock()
            return
        }
        lock.unlock()
        handler.onGroups(groups)
    }

    private func beginCallbackTransaction() {
        callbackLock.lock()
        callbackDepth += 1
    }

    private func endCallbackTransaction() {
        precondition(callbackDepth > 0, "unbalanced monitor callback transaction")
        callbackDepth -= 1
        let receivers = callbackDepth == 0 ? receiversAwaitingClose : []
        if callbackDepth == 0 { receiversAwaitingClose.removeAll(keepingCapacity: true) }
        callbackLock.unlock()
        receivers.forEach { $0.close() }
    }

    @discardableResult
    private func enqueueReceiverForClose(
        _ receiver: ObservationReceiver?
    ) -> ObservationReceiver? {
        guard let receiver else { return nil }
        guard callbackDepth > 0 else { return receiver }
        receiversAwaitingClose.append(receiver)
        return nil
    }

    // MARK: - 反向命令（官方 App→扩展通道）

    private func send(_ command: ObservationCommand) {
        let payload = ObservationCommandCodec.encode(command)
        Task { @MainActor [sessionAccess] in
            do {
                try sessionAccess.sendProviderCommand(payload)
            } catch {
                // 档位不是 debug：统一日志的 debug 默认不持久化、Console 也默认不显示，等于不留证据
                // （观察面故障不升级为数据面故障，但不等于不记录）。命令发不出去的
                // 现象是「点了节点什么都没发生」，没有这一行两侧日志里都查不到。
                logger.error("send provider command failed: \(describe(error), privacy: .public)")
            }
        }
    }

    // 挂载/重连时索取一次快照：UI 立即有流量与分组，不必等下一次推送。
    private func requestSnapshot(statusGeneration expectedStatusGeneration: UInt64) {
        let payload = ObservationCommandCodec.encode(.snapshotRequest)
        lock.lock()
        guard statusGeneration == expectedStatusGeneration,
              status == .started,
              handler != nil else {
            lock.unlock()
            return
        }
        if snapshotInFlight {
            snapshotRefreshPending = true
            lock.unlock()
            return
        }
        snapshotInFlight = true
        snapshotRefreshPending = false
        snapshotGeneration &+= 1
        let flightGeneration = snapshotGeneration
        lock.unlock()

        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            let interval = signposter.beginInterval("ObservationSnapshot")
            defer { signposter.endInterval("ObservationSnapshot", interval) }
            defer { finishSnapshot(snapshotGeneration: flightGeneration) }
            guard !Task.isCancelled,
                  isSnapshotCurrent(
                    snapshotGeneration: flightGeneration,
                    statusGeneration: expectedStatusGeneration
                  ) else { return }
            do {
                let response = try await sessionAccess.requestProviderMessage(payload, timeout: 2)
                guard !Task.isCancelled,
                      isSnapshotCurrent(
                        snapshotGeneration: flightGeneration,
                        statusGeneration: expectedStatusGeneration
                      ) else { return }
                let decoded = await Task.detached(priority: .utility) {
                    ObservationSnapshotCodec.decode(response)
                }.value
                guard !Task.isCancelled,
                      isSnapshotCurrent(
                        snapshotGeneration: flightGeneration,
                        statusGeneration: expectedStatusGeneration
                      ) else { return }
                guard let snapshot = decoded else { return }
                if let traffic = snapshot.traffic {
                    dispatchSnapshot(
                        .traffic(traffic),
                        snapshotGeneration: flightGeneration,
                        statusGeneration: expectedStatusGeneration
                    )
                }
                if !snapshot.groups.isEmpty {
                    dispatchSnapshot(
                        groups: snapshot.groups,
                        snapshotGeneration: flightGeneration,
                        statusGeneration: expectedStatusGeneration
                    )
                }
            } catch {
                guard !Task.isCancelled else { return }
                // 同上不落 debug：索取失败的现象是 UI 停在空态，而空态与「真的没有数据」无从区分。
                logger.error("request provider snapshot failed: \(describe(error), privacy: .public)")
            }
        }
        lock.lock()
        let remainsCurrent = snapshotGeneration == flightGeneration
            && snapshotInFlight
            && statusGeneration == expectedStatusGeneration
            && status == .started
            && handler != nil
        if remainsCurrent {
            snapshotTask = task
            lock.unlock()
        } else {
            lock.unlock()
            task.cancel()
        }
    }

    private func cancelSnapshot() {
        lock.lock()
        let task = snapshotTask
        // Task 取消只废弃结果；NE 请求仍会等回包或 2 秒超时，故不能提前释放物理单飞占用。
        snapshotRefreshPending = false
        lock.unlock()
        task?.cancel()
    }

    private func finishSnapshot(snapshotGeneration completedGeneration: UInt64) {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        guard snapshotGeneration == completedGeneration else {
            lock.unlock()
            return
        }
        snapshotTask = nil
        snapshotInFlight = false
        let shouldRefresh = snapshotRefreshPending && status == .started && handler != nil
        snapshotRefreshPending = false
        let currentStatusGeneration = statusGeneration
        lock.unlock()
        if shouldRefresh {
            requestSnapshot(statusGeneration: currentStatusGeneration)
        }
    }

    private func isSnapshotCurrent(
        snapshotGeneration expectedSnapshotGeneration: UInt64,
        statusGeneration expectedStatusGeneration: UInt64
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return snapshotGeneration == expectedSnapshotGeneration
            && snapshotInFlight
            && statusGeneration == expectedStatusGeneration
            && status == .started
            && handler != nil
    }

    private func dispatchSnapshot(
        _ frame: ObservationFrame,
        snapshotGeneration expectedSnapshotGeneration: UInt64,
        statusGeneration expectedStatusGeneration: UInt64
    ) {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        guard snapshotGeneration == expectedSnapshotGeneration,
              snapshotInFlight,
              statusGeneration == expectedStatusGeneration,
              status == .started,
              let handler else {
            lock.unlock()
            return
        }
        lock.unlock()
        switch frame {
        case .traffic(let traffic): handler.onTraffic(traffic)
        case .log(let line): handler.onLog(line)
        case .groupsInvalidation: break
        case .sessionStats(let stats): (handler as? SessionStatsHandler)?.onSessionStats(stats)
        }
    }

    private func dispatchSnapshot(
        groups: [NodeGroup],
        snapshotGeneration expectedSnapshotGeneration: UInt64,
        statusGeneration expectedStatusGeneration: UInt64
    ) {
        beginCallbackTransaction()
        defer { endCallbackTransaction() }
        lock.lock()
        guard snapshotGeneration == expectedSnapshotGeneration,
              snapshotInFlight,
              statusGeneration == expectedStatusGeneration,
              status == .started,
              let handler else {
            lock.unlock()
            return
        }
        lock.unlock()
        handler.onGroups(groups)
    }

}
