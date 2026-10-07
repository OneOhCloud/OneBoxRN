import Foundation
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "Observation")

/// 观察通道非自愿终止的原因。主动关闭**不**走这条路径。
enum ObservationChannelTermination: Sendable, Equatable {
    /// 端点被摘名或替换：路径不在了、inode 变了、或已不是 socket。
    case endpointLost(detail: String)
    /// 读循环致命错误（含资源错误连续超限）。
    case fatal(detail: String)

    var detail: String {
        switch self {
        case .endpointLost(let detail): return "endpoint lost: \(detail)"
        case .fatal(let detail): return "read loop failed: \(detail)"
        }
    }
}

// 观察接收端（UI 侧）：持端点所有权锁 + bind App Group 内的 datagram 端点，
// 后台读循环把帧解成中立类型。
//
// 为何 UI 侧 bind、:tun 侧发：NE 扩展无法被 bind/连接，官方 App↔扩展通道只能由 App 发起
// 请求-响应；要让 provider 主动推观察数据，只能由 UI 提供一个固定端点、provider 往它送。
//
// 端点路径住在**按 group id 共享**的容器里，故所有权由一把排他锁判定；失窃与断流
// 由读循环按绝对 deadline 检测并上报，重建归 `MonitorBinding`。
// 而共享容器里的锁在进程挂起时会招来系统的处决，故 `close()` 当场交还所有权。
final class ObservationReceiver: @unchecked Sendable {
    /// 通道代际：终止回调据此让 binding 分辨「这是当前通道」还是「一条晚到的旧回执」。
    let generation: UInt64

    private let worker: ObservationReceiverWorker

    /// - Throws: `ObservationEndpointFailure`；其中 `.busy` 表示端点归另一个活实例，
    ///   本实例本次会话没有观察数据，这是预期结局而非缺陷。
    /// 路径端点（iOS 与测试）：在 `baseDirectory` 里取所有权并 bind。
    convenience init(
        baseDirectory: URL,
        generation: UInt64,
        onFrame: @escaping @Sendable (ObservationFrame) -> Void,
        onGroups: @escaping @Sendable ([NodeGroup]) -> Void,
        onStale: @escaping @Sendable (Bool, UInt64) -> Void,
        onTerminated: @escaping @Sendable (ObservationChannelTermination, UInt64) -> Void
    ) throws {
        let files = ContainerTunnelFiles(base: baseDirectory)
        try self.init(
            endpoint: try ObservationEndpointOwnership.claim(baseDirectory: baseDirectory),
            readSnapshot: { try files.read(.groupsSnapshot) },
            generation: generation,
            onFrame: onFrame,
            onGroups: onGroups,
            onStale: onStale,
            onTerminated: onTerminated
        )
    }

    /// - Parameter readSnapshot: 读分组快照；nil = 文件不存在。快照由隧道侧原子替换写入。
    init(
        endpoint ownership: any ObservationReceiveEndpoint,
        readSnapshot: @escaping @Sendable () throws -> Data?,
        generation: UInt64,
        onFrame: @escaping @Sendable (ObservationFrame) -> Void,
        onGroups: @escaping @Sendable ([NodeGroup]) -> Void,
        onStale: @escaping @Sendable (Bool, UInt64) -> Void,
        onTerminated: @escaping @Sendable (ObservationChannelTermination, UInt64) -> Void
    ) throws {
        self.generation = generation

        var wakeDescriptors = [Int32](repeating: -1, count: 2)
        let pipeCreated = wakeDescriptors.withUnsafeMutableBufferPointer { descriptors in
            Darwin.pipe(descriptors.baseAddress!)
        }
        guard pipeCreated == 0 else {
            ownership.release()
            throw ObservationEndpointFailure.systemCall(call: "pipe", errorCode: errno)
        }
        let wakeWriteFlags = fcntl(wakeDescriptors[1], F_GETFL, 0)
        guard wakeWriteFlags >= 0,
              fcntl(wakeDescriptors[1], F_SETFL, wakeWriteFlags | O_NONBLOCK) == 0 else {
            let code = errno
            Darwin.close(wakeDescriptors[0])
            Darwin.close(wakeDescriptors[1])
            ownership.release()
            throw ObservationEndpointFailure.systemCall(call: "fcntl(wake)", errorCode: code)
        }

        worker = ObservationReceiverWorker(
            ownership: ownership,
            generation: generation,
            wakeReadDescriptor: wakeDescriptors[0],
            wakeWriteDescriptor: wakeDescriptors[1],
            readSnapshot: readSnapshot,
            onFrame: onFrame,
            onGroups: onGroups,
            onStale: onStale,
            onTerminated: onTerminated
        )
        worker.start()
    }

    deinit { close() }

    /// 线性化停止：**返回时端点所有权已经交还**（路径已摘名、锁已解开），数据 fd 与
    /// 读线程的收尾归读线程，调用方不等它退出。主动关闭**不**触发终止回调（那条路径专表非自愿失效）。
    func close() {
        worker.close()
    }
}

/// 同类错误的连续条纹：首次即记，其后按计数汇总。
///
/// 资源错误可能每毫秒复发一次，逐条记会把日志缓冲刷爆——而缓冲被刷爆本身就掩盖故障。
private struct ErrorStreak {
    private var code: Int32 = 0
    private var count = 0

    private static let reportEvery = 64

    /// - Returns: 本次是否应当记一行诊断，以及当前连续次数。
    mutating func observe(_ errorCode: Int32) -> (shouldReport: Bool, count: Int) {
        if errorCode != code {
            code = errorCode
            count = 1
            return (true, 1)
        }
        count += 1
        return (count % Self.reportEvery == 0, count)
    }

    mutating func reset() {
        code = 0
        count = 0
    }
}

private final class ObservationReceiverWorker: @unchecked Sendable {
    private let ownership: any ObservationReceiveEndpoint
    private let generation: UInt64
    private let wakeReadDescriptor: Int32
    private let wakeWriteDescriptor: Int32
    private let readSnapshot: @Sendable () throws -> Data?
    private let onFrame: @Sendable (ObservationFrame) -> Void
    private let onGroups: @Sendable ([NodeGroup]) -> Void
    private let onStale: @Sendable (Bool, UInt64) -> Void
    private let onTerminated: @Sendable (ObservationChannelTermination, UInt64) -> Void
    private let lock = NSRecursiveLock()
    private var closed = false
    private var readLoopFinished = false
    private var lastGroupsGeneration: UInt64 = 0
    private var datagramDecoder = ObservationDatagramDecoder()

    /// 身份检查节拍：1 秒一次。不能只在「poll 超时」分支检查——持续有可读事件时
    /// 可能长期没有超时轮次，失窃就会拖到下一次静默才被发现。
    private static let identityCheckIntervalMillis: Int64 = 1_000
    /// 资源类错误的短退避与连续上限：无退避地立即重试会在 fd 持续 ready 时把一次可恢复故障
    /// 变成 CPU 打满；超过上限即升级为致命，交给重建而不是原地死磕。
    private static let resourceRetryBackoffMicroseconds: UInt32 = 20_000
    private static let maximumResourceFailureStreak = 32

    init(
        ownership: any ObservationReceiveEndpoint,
        generation: UInt64,
        wakeReadDescriptor: Int32,
        wakeWriteDescriptor: Int32,
        readSnapshot: @escaping @Sendable () throws -> Data?,
        onFrame: @escaping @Sendable (ObservationFrame) -> Void,
        onGroups: @escaping @Sendable ([NodeGroup]) -> Void,
        onStale: @escaping @Sendable (Bool, UInt64) -> Void,
        onTerminated: @escaping @Sendable (ObservationChannelTermination, UInt64) -> Void
    ) {
        self.ownership = ownership
        self.generation = generation
        self.wakeReadDescriptor = wakeReadDescriptor
        self.wakeWriteDescriptor = wakeWriteDescriptor
        self.readSnapshot = readSnapshot
        self.onFrame = onFrame
        self.onGroups = onGroups
        self.onStale = onStale
        self.onTerminated = onTerminated
    }

    func start() {
        let thread = Thread { [self] in readLoop() }
        thread.name = "observation-receiver"
        thread.stackSize = 128 * 1024
        thread.start()
    }

    func close() {
        lock.lock()
        guard !closed else {
            lock.unlock()
            return
        }
        closed = true
        if !readLoopFinished {
            var wakeByte = UInt8(1)
            _ = Darwin.write(wakeWriteDescriptor, &wakeByte, MemoryLayout<UInt8>.size)
        }
        lock.unlock()
        // 所有权在**调用线程**上当场交还：挂起沿容不下「等读线程走到 finish()」，
        // 而读线程可能正卡在一次投递里。置 `closed` 必须在它之前——否则读线程会先看见路径没了、
        // 把一次主动关闭误报成失窃。
        ownership.releaseOwnership()
    }

    // MARK: - 读循环

    private func readLoop() {
        var termination: ObservationChannelTermination?
        defer { finish(termination) }

        var descriptors = [
            pollfd(fd: ownership.socketDescriptor, events: Int16(POLLIN), revents: 0),
            pollfd(fd: wakeReadDescriptor, events: Int16(POLLIN), revents: 0),
        ]
        // 多留一字节才能识别超限 datagram，避免 recvfrom 截断后被当成合法日志。
        var buffer = [UInt8](repeating: 0, count: ObservationFrameCodec.maxDatagramBytes + 1)

        // 断流判据钉在**流量帧**上，不是「收到过任何 datagram」：日志与分组走同一条通道，
        // 引擎停推流量却仍在出日志时，用「任意 datagram」计时会让通道永远不报断流，
        // 消费方（只认流量帧）那边却早已陈旧。
        var lastTrafficAtMillis = MonotonicClock.millis()
        var nextIdentityCheckAt = lastTrafficAtMillis + Self.identityCheckIntervalMillis
        var staleReported = false
        var streak = ErrorStreak()
        var resourceFailures = 0

        while true {
            if isClosed() { return }

            let waitStart = MonotonicClock.millis()
            let timeout = Self.pollTimeoutMillis(
                PollSchedule(
                    now: waitStart,
                    nextIdentityCheckAt: nextIdentityCheckAt,
                    staleDeadlineAt: lastTrafficAtMillis + ObservationFreshness.staleAfterMillis,
                    staleReported: staleReported
                )
            )
            let ready = descriptors.withUnsafeMutableBufferPointer { pointers in
                Darwin.poll(pointers.baseAddress, nfds_t(pointers.count), timeout)
            }

            if ready < 0 {
                let code = errno
                if code == EINTR { continue }
                guard Self.isRetryableResourceErrno(code) else {
                    termination = .fatal(detail: Self.syscallFailure(call: "poll", errorCode: code))
                    return
                }
                if let failure = backOffAfterResourceFailure(
                    ResourceFailure(call: "poll", errorCode: code),
                    streak: &streak,
                    failures: &resourceFailures
                ) {
                    termination = failure
                    return
                }
                continue
            }

            if isClosed() { return }
            // 唤醒管道只由 close() 写：任何事件都表示本端要停，正常退出、不报终止。
            if descriptors[1].revents & Int16(POLLIN | POLLERR | POLLHUP | POLLNVAL) != 0 { return }

            // 安静地等到超时同样是健康信号，据此清零失败条纹。
            // 若只在「成功收帧」时清零，长跑中零星的瞬态资源错误会一路累加到上限，
            // 最终把一条好通道判成致命——那是把偶发噪声攒成了故障。
            if ready == 0 {
                resourceFailures = 0
                streak.reset()
            }

            // **先把可读数据收完，再处置错误位**：两者可以同时出现在同一次 revents 上。
            if descriptors[0].revents & Int16(POLLIN) != 0 {
                switch receiveDatagram(into: &buffer) {
                case .received(let datagram):
                    // 收到 datagram 说明 socket 本身健康，故清失败条纹；但只有**流量帧**
                    // 才推进断流时钟（见上）。
                    resourceFailures = 0
                    streak.reset()
                    if dispatch(datagram) {
                        lastTrafficAtMillis = MonotonicClock.millis()
                        reportRecoveryIfNeeded(&staleReported)
                    }
                case .discarded:
                    // 零长度 datagram 是合法帧、不是流结束（SOCK_DGRAM 的 0 不等于 EOF）。
                    // 端点对同 group 的任何进程可写，故这条路径可达。它不是流量帧，不推进断流时钟。
                    resourceFailures = 0
                    streak.reset()
                case .retryable(let code):
                    if let failure = backOffAfterResourceFailure(
                        ResourceFailure(call: "recvfrom", errorCode: code),
                        streak: &streak,
                        failures: &resourceFailures
                    ) {
                        termination = failure
                        return
                    }
                    continue
                case .interrupted:
                    continue
                case .failed(let code):
                    termination = .fatal(detail: Self.syscallFailure(call: "recvfrom", errorCode: code))
                    return
                }
            }

            if let pollFailure = Self.terminationForErrorFlags(descriptors[0], socket: ownership.socketDescriptor) {
                termination = pollFailure
                return
            }

            let now = MonotonicClock.millis()
            if now >= nextIdentityCheckAt {
                nextIdentityCheckAt = now + Self.identityCheckIntervalMillis
                if let lost = ownership.lossDetail() {
                    termination = .endpointLost(detail: lost)
                    return
                }
            }
            if !staleReported,
               ObservationFreshness.isStale(lastFrameAtMillis: lastTrafficAtMillis, nowMillis: now) {
                staleReported = true
                logger.error(
                    """
                    observation channel stalled: no traffic frame for \
                    \(now - lastTrafficAtMillis, privacy: .public) ms
                    """
                )
                onStale(true, generation)
            }
        }
    }

    /// 恢复同样要推一次：呈现层靠推送翻转，不会因为「时间又过去了」自己重算。
    private func reportRecoveryIfNeeded(_ staleReported: inout Bool) {
        guard staleReported else { return }
        staleReported = false
        logger.log("observation channel recovered")
        onStale(false, generation)
    }

    /// 等待上限取「下一次身份检查」与「下一次新鲜度到期」的近者，不在代码里散布多个固定超时值。
    private static func pollTimeoutMillis(_ schedule: PollSchedule) -> Int32 {
        let deadline = schedule.staleReported
            ? schedule.nextIdentityCheckAt
            : min(schedule.nextIdentityCheckAt, schedule.staleDeadlineAt)
        // 至少 1 ms：deadline 已过时也不能传 0（那是「立即返回」，会退化成忙轮询）。
        return Int32(clamping: max(deadline - schedule.now, 1))
    }

    private enum DatagramOutcome {
        case received(Data)
        /// 收到了但不该当作帧处理（零长度）。仍算通道有活性。
        case discarded
        case interrupted
        case retryable(Int32)
        case failed(Int32)
    }

    private func receiveDatagram(into buffer: inout [UInt8]) -> DatagramOutcome {
        let received = buffer.withUnsafeMutableBytes { raw in
            recvfrom(ownership.socketDescriptor, raw.baseAddress, raw.count, 0, nil, nil)
        }
        guard received >= 0 else {
            let code = errno
            if code == EINTR { return .interrupted }
            return Self.isRetryableResourceErrno(code) ? .retryable(code) : .failed(code)
        }
        guard received > 0 else { return .discarded }
        return .received(Data(buffer[0..<received]))
    }

    /// 资源类瞬态：短退避后重试；连续超限即升级为致命，交给重建而不是原地死磕。
    private func backOffAfterResourceFailure(
        _ failure: ResourceFailure,
        streak: inout ErrorStreak,
        failures: inout Int
    ) -> ObservationChannelTermination? {
        failures += 1
        let report = streak.observe(failure.errorCode)
        if report.shouldReport {
            logger.error(
                """
                observation \(failure.call, privacy: .public) transient failure ×\(report.count, privacy: .public): \
                \(String(cString: strerror(failure.errorCode)), privacy: .public)
                """
            )
        }
        guard failures < Self.maximumResourceFailureStreak else {
            return .fatal(
                detail: "\(Self.syscallFailure(call: failure.call, errorCode: failure.errorCode)) ×\(failures)"
            )
        }
        usleep(Self.resourceRetryBackoffMicroseconds)
        return nil
    }

    private struct PollSchedule {
        let now: Int64
        let nextIdentityCheckAt: Int64
        let staleDeadlineAt: Int64
        let staleReported: Bool
    }

    private struct ResourceFailure {
        let call: String
        let errorCode: Int32
    }

    /// 诊断串保留**原始 errno 数值**：符号名随平台头文件版本变，数字才可检索、可跨机器比对
    /// （与诊断里「系统的码要翻成符号名但保留原始码」同一姿态）。
    private static func syscallFailure(call: String, errorCode: Int32) -> String {
        "\(call): \(String(cString: strerror(errorCode))) (errno \(errorCode))"
    }

    /// 阻塞式 UDS datagram 接收端上，这些 errno 属可恢复瞬态；其余（`EBADF`/`ENOTSOCK`/`EINVAL` 等）
    /// 是生命周期或编程错误，继续重试只会掩盖问题。
    private static func isRetryableResourceErrno(_ code: Int32) -> Bool {
        code == ENOBUFS || code == ENOMEM || code == EAGAIN || code == EWOULDBLOCK
    }

    /// 数据 fd 上的错误位逐位处置；本端是无连接接收端，`POLLHUP` 不属正常语义。
    private static func terminationForErrorFlags(
        _ descriptor: pollfd,
        socket: Int32
    ) -> ObservationChannelTermination? {
        if descriptor.revents & Int16(POLLNVAL) != 0 {
            return .fatal(detail: "data descriptor invalid (POLLNVAL)")
        }
        if descriptor.revents & Int16(POLLERR) != 0 {
            var socketError = Int32.zero
            var size = socklen_t(MemoryLayout<Int32>.size)
            let queried = getsockopt(socket, SOL_SOCKET, SO_ERROR, &socketError, &size)
            let detail = queried == 0
                ? "POLLERR SO_ERROR=\(String(cString: strerror(socketError)))"
                : "POLLERR (SO_ERROR unavailable)"
            return .fatal(detail: detail)
        }
        if descriptor.revents & Int16(POLLHUP) != 0 {
            return .fatal(detail: "unexpected POLLHUP on unconnected receiver")
        }
        return nil
    }

    // MARK: - 收尾

    /// 读循环唯一出口：先回收 fd / 端点路径 / 所有权锁，再上报终止（exactly-once）。
    ///
    /// 次序不可颠倒——binding 收到回执就会立刻重建，此刻锁必须已经释放、路径必须已经摘名，
    /// 否则重建会撞上自己刚才还没放开的那把锁。
    private func finish(_ termination: ObservationChannelTermination?) {
        lock.lock()
        readLoopFinished = true
        let voluntary = closed
        lock.unlock()

        Darwin.close(wakeReadDescriptor)
        Darwin.close(wakeWriteDescriptor)
        // 主动关闭那条路上所有权已在 `close()` 里交还过，这里是幂等的第二次；非自愿终止时
        // 这就是唯一一次。数据 fd 只能在这里关——读循环到此才不再碰它。
        ownership.release()

        guard !voluntary, let termination else { return }
        logger.error("observation channel terminated: \(termination.detail, privacy: .public)")
        onTerminated(termination, generation)
    }

    private func isClosed() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }

    // MARK: - 帧派发

    /// - Returns: 本次是否投递了**流量帧**（断流时钟只认它）。
    @discardableResult
    private func dispatch(_ data: Data) -> Bool {
        switch datagramDecoder.decode(data) {
        case .awaitingMore:
            return false
        case .invalid:
            logger.debug("observation frame discarded (undecodable)")
            return false
        case .frames(let frames):
            var deliveredTraffic = false
            for frame in frames {
                if case .groupsInvalidation(let generation) = frame {
                    loadSnapshot(generation: generation)
                } else {
                    if case .traffic = frame { deliveredTraffic = true }
                    deliver(frame)
                }
            }
            return deliveredTraffic
        }
    }

    private func deliver(_ frame: ObservationFrame) {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        onFrame(frame)
    }

    // 代号回退即丢弃：datagram 可乱序，陈旧 invalidation 不该覆盖较新的快照。
    private func loadSnapshot(generation: UInt64) {
        lock.lock()
        let stale = closed || generation <= lastGroupsGeneration
        if !stale { lastGroupsGeneration = generation }
        lock.unlock()
        guard !stale else { return }
        // 档位不是 debug：统一日志的 debug 默认不持久化、Console 也默认不显示，等于不留证据
        //。这条沿失效的现象是节点列表永久空白，而空白与「真的没有分组」
        // 在界面上一模一样。读失败与解码失败也分开说——写侧是原子替换，后者只可能是编码分叉。
        let data: Data
        do {
            guard let read = try readSnapshot() else {
                logger.error("groups snapshot missing after invalidation \(generation, privacy: .public)")
                return
            }
            data = read
        } catch {
            logger.error("groups snapshot unreadable: \(describe(error), privacy: .public)")
            return
        }
        guard let groups = GroupsSnapshotCodec.decode(data) else {
            logger.error("groups snapshot undecodable (\(data.count, privacy: .public) bytes)")
            return
        }

        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        onGroups(groups)
    }
}
