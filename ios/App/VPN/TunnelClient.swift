import Foundation
import Observation
import Core

// 消费 Monitor 契约 → @Observable 状态。回调可能在任意后台线程：
// MonitorHandler 方法声明 nonisolated，内部 hop 到 MainActor 再改状态。
@MainActor
@Observable
final class TunnelClient {
    private(set) var status: EngineStatus = .stopped
    private(set) var traffic: Traffic = TunnelClient.emptyTraffic
    private(set) var groups: [NodeGroup] = []

    /// 引擎分组推送计数（乐观选中的回摆判据）：任一次推送到达即以引擎真相为准，
    /// 无论选中值是否变化——切换未生效时 `now` 恰恰不变，只比对值会让乐观值永久滞留。
    private(set) var groupsGeneration = 0

    /// 扩展侧会话统计的最近一份：整份替换、随停止清空，App 不在本地累积。
    /// App 挂起期观察通道停流，本地攒的窗口必然断档；扩展进程一直在跑，它的窗口才是连续的。
    private(set) var sessionStats: SessionStats?

    /// 最近一份统计的到达时刻。统计帧与流量帧是两个独立可丢的 datagram，流量帧新鲜
    /// 不代表统计新鲜，各判各的。
    private(set) var sessionStatsAtMillis: Int64?

    var sessionStatsStale: Bool {
        ObservationFreshness.isStale(lastFrameAtMillis: sessionStatsAtMillis, nowMillis: nowMillis())
    }

    /// 启动失败诊断：挂载读持久化兜底，onError 事件更新；
    /// 下次成功启动清除（失败态持续到下次成功启动）。
    private(set) var lastError: EngineError?

    /// 上面那份诊断**从哪条通道来的**。与 `lastError` 同写同清，不另立生命周期。
    ///
    /// 本类型有两个写入口，而它们的来源不是同一个：
    /// - `monitor.lastError()` 读的是隧道进程写在盘上的那份 ⇒ `.tunnel`：
    ///   **引擎不一定说过话**，那份可能只有阶段标记。
    /// - `onError(_:)` 是观察通道实时推来的引擎事件 ⇒ `.engine`。
    ///
    /// 两者合流进同一个字段就分不开了，弹层只能无条件写「引擎事件」。
    private(set) var lastErrorSource: FailureSource?

    /// 诊断观察时刻（失败弹层时间行用）：**只在 App 亲眼观察到失败的那一拍打点**。
    /// 挂载读到的持久化诊断没有可信时刻，故留 nil，弹层时间行占位「—」（不谎称）。
    private(set) var lastErrorAt: Date?

    /// 本次会话最近一帧 `Traffic` 的到达时刻；nil = 本次会话尚无任何帧。
    /// 时钟与趋势窗同一份，不引入第二个时间来源。
    private(set) var lastFrameAtMillis: Int64?

    /// 观察通道健康度：由通道层主动推送，**不是**这里按时间自己算出来的。
    private(set) var observationHealth = ObservationHealth.idle

    /// 运行时读数是否已不可信：断流态与「本次会话尚无帧」二者其一即成立。
    ///
    /// 尚无帧时立即成立而不等 15 秒：此刻 `traffic` 里躺的是**上一次会话**的最后一帧
    /// （停止沿只清两块趋势、不清 `Traffic` 本身），等下去等于拿上次的数字冒充本次。
    var trafficStale: Bool {
        observationHealth.stalled
            || ObservationFreshness.isStale(lastFrameAtMillis: lastFrameAtMillis, nowMillis: nowMillis())
    }

    /// 距最近一帧的毫秒数；nil = 本次会话尚无任何帧。
    var observationElapsedMillis: Int64? {
        ObservationFreshness.elapsedMillis(lastFrameAtMillis: lastFrameAtMillis, nowMillis: nowMillis())
    }

    @ObservationIgnored private let monitor: Monitor
    /// 挂载时上次会话的诊断还没读到（诊断来源不可达）；只供 `mount` 决定要不要重读。
    @ObservationIgnored private var previousOutcomeUnknown = false
    @ObservationIgnored private let logStore: LogStore
    @ObservationIgnored nonisolated private let logBatcher: EngineLogBatcher

    /// 趋势窗的时钟：必须单调且**计入系统睡眠**，否则挂起恢复后算出的间隔远小于真实间隔、
    /// 时间窗等于没有。参数化只为单测可控，生产恒用 `MonotonicClock.millis`。
    @ObservationIgnored private let nowMillis: @Sendable () -> Int64

    init(
        monitor: Monitor,
        logStore: LogStore,
        nowMillis: @escaping @Sendable () -> Int64 = MonotonicClock.millis
    ) {
        self.monitor = monitor
        self.logStore = logStore
        self.nowMillis = nowMillis
        logBatcher = EngineLogBatcher(logStore: logStore)
        monitor.setHandler(self)
        previousOutcomeUnknown = !adoptPreviousOutcome()
    }

    /// 构造即读上次启动的诊断；读不到时按预算重读，预算用尽仍读不到就不发布——
    /// 那时只是不知道上次的结局，不是「上次启动失败了」。
    static func mount(
        monitor: Monitor,
        logStore: LogStore,
        retry: PreviousOutcomeRetry = .production
    ) async -> TunnelClient {
        let client = TunnelClient(monitor: monitor, logStore: logStore)
        let deadline = ContinuousClock.now + retry.budget
        while client.previousOutcomeUnknown, ContinuousClock.now < deadline {
            try? await Task.sleep(for: retry.interval)
            client.previousOutcomeUnknown = !client.adoptPreviousOutcome()
        }
        return client
    }

    /// 读上次会话留下的诊断并发布；返回 false = 诊断所在处不可达，什么也没发布。
    private func adoptPreviousOutcome() -> Bool {
        do {
            lastError = try monitor.lastError()
            lastErrorSource = lastError == nil ? nil : .tunnel
            return true
        } catch {
            logStore.append(
                source: .app,
                level: .info,
                message: "previous start outcome unknown: \(describe(error))"
            )
            return false
        }
    }

    func selectNode(tag: String) {
        monitor.selectNode(tag: tag)
    }

    /// 读盘上那份诊断，**不发布**（诊断阶梯前两级的合成要它）。
    ///
    /// **合成期间只许走这条，不许走 `refreshLastError()`** —— 那一条带副作用：
    /// 它会把**未合成**的那句先写进 `lastError`，而 `AppNav` 的失败弹层只认**第一次**
    /// nil→非空（`if previous == nil, let current`）⇒ 当场 latch 住未合成那句，
    /// 随后的合成结果**再也上不了台面**。
    ///
    /// 这三个方法是同一件事的三个角色，别合流（命令与查询分离）：
    /// **读** `tunnelDiagnosis()` · **发布** `refreshLastError()` · **清** `clearLastError()`。
    ///
    /// 只在一次真实尝试失败的那一拍被问：此时诊断读不到也照实成为失败详情。
    func tunnelDiagnosis() -> EngineError? { failureEdgeDiagnosis() }

    /// 失败拍强制重读持久化诊断：挂载只在初始化读过一次，其后的启动失败不重读
    /// 会让等待者取到陈旧缓存。只在读到真实诊断时更新（失败态持续到下次成功启动）。
    func refreshLastError() {
        guard let fresh = failureEdgeDiagnosis() else { return }
        lastError = fresh
        lastErrorSource = .tunnel
        lastErrorAt = Date()
    }

    /// 清掉缓存里的诊断。
    ///
    /// **它不能用 `refreshLastError()` 代劳**：那一条在盘上已空时 `guard ... else { return }`
    /// **早退**，旧值原样留着 —— 于是「清了」与「没清」在代码里长得一模一样，
    /// 而屏上是上一次尝试的结局钉在这一次的弹层里。**「读不到新的」不等于「清空了」。**
    func clearLastError() {
        lastError = nil
        lastErrorSource = nil
        lastErrorAt = nil
    }

    /// 失败沿上的读取：尝试确实失败了，诊断读不到只决定详情写什么，不决定有没有失败。
    private func failureEdgeDiagnosis() -> EngineError? {
        do {
            return try monitor.lastError()
        } catch {
            return startDiagnosisUnreachable(reason: describe(error))
        }
    }

    private static let emptyTraffic = Traffic(
        up: 0, down: 0, upTotal: 0, downTotal: 0, memory: 0, connIn: 0, connOut: 0
    )
}

extension TunnelClient: MonitorHandler {
    nonisolated func onStatus(_ status: EngineStatus) {
        Task { @MainActor in
            self.status = status
            if status == .started {
                self.lastError = nil
                self.lastErrorSource = nil
                self.lastErrorAt = nil
            }
            // 停止即清空会话统计，不跨连接会话保留（traffic 本身停在最后一帧）。
            if status == .stopped {
                self.sessionStats = nil
                self.sessionStatsAtMillis = nil
                // 帧时刻同样随会话清除——否则 15 秒内重连会拿上一次会话的时刻当本次的，
                // 新会话首帧还没到就先把上一次的数字当成实时读数显示出来。
                self.lastFrameAtMillis = nil
                self.observationHealth = .idle
            }
        }
    }

    nonisolated func onTraffic(_ traffic: Traffic) {
        Task { @MainActor in
            self.traffic = traffic
            // 时刻在 MainActor 内读：断流判据要的是「本进程最近一次收到帧」的时刻。
            self.lastFrameAtMillis = self.nowMillis()
        }
    }


    nonisolated func onGroups(_ groups: [NodeGroup]) {
        Task { @MainActor in
            self.groups = groups
            self.groupsGeneration += 1
        }
    }

    // ENGINE 源喂入点：引擎日志经 Monitor onLog 落唯一缓冲（SGR 剥离在 LogStore 入储处）。
    nonisolated func onLog(_ line: LogLine) {
        guard let pending = LogStore.prepareForStorage(
            source: .engine,
            level: line.level,
            message: line.message
        ) else { return }
        logBatcher.enqueue(pending)
    }

    nonisolated func onError(_ error: EngineError) {
        Task { @MainActor in
            self.lastError = error
            // 这一条是观察通道实时推来的**引擎事件**，与挂载时读盘那一份来源不同。
            self.lastErrorSource = .engine
            self.lastErrorAt = Date()
        }
    }

    // 健康度由通道层推来，本层只存不判——判据（阈值）在 core，触发在通道。
    nonisolated func onObservationHealth(_ health: ObservationHealth) {
        Task { @MainActor in
            let wasStalled = self.observationHealth.stalled
            self.observationHealth = health
            // `idle` = 会话或绑定重来。此刻手里的帧时刻属于**上一条**通道，
            // 留着它会让新通道首帧到达前的十几秒里继续显示上一条的读数。
            if health == .idle { self.lastFrameAtMillis = nil }
            guard wasStalled != health.stalled else { return }
            // 断流与恢复各落一行 APP 源，日志页因此能解释 ENGINE 段为什么停了。
            self.logStore.append(
                source: .app,
                level: health.stalled ? .warn : .info,
                message: health.stalled ? "observation channel stalled" : "observation channel resumed"
            )
        }
    }
}

/// 后台回调只做有界入队；每 100 ms 至多一个批次，且主队列确认后才继续，避免任务与 dispatch block 积压。
private final class EngineLogBatcher: @unchecked Sendable {
    private let lock = NSLock()
    private let workerQueue = DispatchQueue(label: "cloud.oneoh.networktools.engine-log-batcher", qos: .utility)
    private let logStore: LogStore
    private var pending = PendingLogRing(capacity: LogStore.capacity)
    private var scheduledFlush: DispatchWorkItem?
    private var deliveryInFlight = false

    private static let flushInterval: DispatchTimeInterval = .milliseconds(100)
    private static let maximumBatchCount = 64
    private static let maximumBatchBytes = 48 * 1024

    init(logStore: LogStore) {
        self.logStore = logStore
    }

    func enqueue(_ entry: PendingLogEntry) {
        lock.lock()
        pending.append(entry)
        scheduleFlushIfNeeded()
        lock.unlock()
    }

    private func scheduleFlushIfNeeded() {
        guard scheduledFlush == nil, !deliveryInFlight else { return }
        let work = DispatchWorkItem { [weak self] in self?.flush() }
        scheduledFlush = work
        workerQueue.asyncAfter(deadline: .now() + Self.flushInterval, execute: work)
    }

    private func flush() {
        lock.lock()
        scheduledFlush = nil
        let batch = pending.removeBatch(
            maximumCount: Self.maximumBatchCount,
            maximumBytes: Self.maximumBatchBytes
        )
        deliveryInFlight = !batch.isEmpty
        lock.unlock()

        guard !batch.isEmpty else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            MainActor.assumeIsolated {
                self.logStore.appendBatch(batch)
            }
            self.finishDelivery()
        }
    }

    private func finishDelivery() {
        lock.lock()
        deliveryInFlight = false
        if !pending.isEmpty { scheduleFlushIfNeeded() }
        lock.unlock()
    }
}

/// 固定容量环避免洪峰期数组头删与无界任务排队；满载时只保留最新 1000 条。
private struct PendingLogRing {
    private var storage: [PendingLogEntry?]
    private var head = 0
    private(set) var count = 0

    var isEmpty: Bool { count == 0 }

    init(capacity: Int) {
        precondition(capacity > 0, "log batch capacity must be positive")
        storage = Array(repeating: nil, count: capacity)
    }

    mutating func append(_ entry: PendingLogEntry) {
        if count == storage.count {
            storage[head] = entry
            head = (head + 1) % storage.count
            return
        }
        storage[(head + count) % storage.count] = entry
        count += 1
    }

    mutating func removeBatch(maximumCount: Int, maximumBytes: Int) -> [PendingLogEntry] {
        precondition(maximumCount > 0 && maximumBytes > 0, "log batch limits must be positive")
        var batch: [PendingLogEntry] = []
        batch.reserveCapacity(min(maximumCount, count))
        var bytes = 0

        while count > 0 && batch.count < maximumCount {
            guard let entry = storage[head] else {
                preconditionFailure("log batch ring contains an empty occupied slot")
            }
            if !batch.isEmpty && bytes + entry.storageByteCount > maximumBytes { break }
            storage[head] = nil
            head = (head + 1) % storage.count
            count -= 1
            bytes += entry.storageByteCount
            batch.append(entry)
        }
        return batch
    }
}

extension TunnelClient: SessionStatsHandler {
    nonisolated func onSessionStats(_ stats: SessionStats) {
        Task { @MainActor in
            self.sessionStats = stats
            self.sessionStatsAtMillis = self.nowMillis()
        }
    }
}

/// 挂载读上次诊断的重读节奏：按时间设上界而非次数——服务卡住时单次读要等满请求超时。
struct PreviousOutcomeRetry {
    let interval: Duration
    let budget: Duration

    static let production = PreviousOutcomeRetry(interval: .milliseconds(500), budget: .seconds(10))
}
