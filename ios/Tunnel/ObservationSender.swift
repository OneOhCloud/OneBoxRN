import Foundation
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.tunnel", category: "Observation")

// 观察发送端（:tun → UI，单向 datagram）。
//
// 为何是「非阻塞 + 满即丢」：观察数据由内核回调线程推送，若因 UI 消费慢而阻塞或排队，
// 就把 UI 的消费速度传导成了隧道背压。故 socket 置 O_NONBLOCK，发送失败（UI 未连、
// 缓冲满）直接丢弃当前帧，不重试、不排队、不增长缓冲。
//
// groups 走 App Group 原子文件 + datagram 只发 invalidation：组列表长度不定，
// datagram 装不下也不该分片。快照写盘在自有串行队列上执行，不占引擎回调线程。
final class ObservationSender: ObservationSink, @unchecked Sendable {
    private static let logFlushDelay = DispatchTimeInterval.milliseconds(100)
    /// 同一 errno 连续丢帧时的汇总间隔：1 Hz 的流量帧下约每 64 秒一行，足够看出「还在丢」
    /// 而不至于淹没隧道日志。
    private static let dropReportInterval: UInt64 = 64

    private let outlet: any ObservationDatagramOutlet
    private let snapshotUrl: URL
    private let stateLock = NSLock()
    private let sendLock = NSLock()
    private let logFlushQueue = DispatchQueue(label: "engine.observation.log-batch", qos: .utility)
    private let snapshotQueue = DispatchQueue(label: "engine.observation.groups-snapshot", qos: .utility)
    private var groupsGeneration: UInt64 = 0
    private var logBatchGeneration: UInt64 = 0
    private var pendingLogs = ObservationPendingLogBuffer()
    private var logFlushScheduled = false
    /// 丢帧的连续条纹（errno + 计数）：errno 变化即记，其后按 `dropReportInterval` 汇总。
    private var dropStreakErrorCode: Int32 = 0
    private var dropStreakCount: UInt64 = 0
    // 发送端闸:流量帧探针维护;不可达期日志不攒批、分组不写盘不发代号。
    private var peerBelief = ObservationPeerBelief()

    /// iOS 端点路径超出 sun_path 容量即返回 nil——宁可不接观察通道，也不静默截断成错误路径。
    init?(baseDirectory: URL) {
        guard let outlet = PathDatagramOutlet(
            socketPath: baseDirectory.appendingPathComponent(ObservationEndpoint.socketName).path
        ) else { return nil }
        self.outlet = outlet
        self.snapshotUrl = AppGroupPaths.url(.groupsSnapshot, base: baseDirectory)
    }

    deinit {
        flushPendingLogs()
    }

    // MARK: - ObservationSink

    func emitTraffic(_ traffic: Traffic) {
        // 流量帧恒发(64B/s 兼作探针);其回执是对端可达信念的唯一输入。
        let (sent, errorCode) = sendReturningErrno(ObservationFrameCodec.encode(.traffic(traffic)))
        let outcome: TrafficSendOutcome
        if sent {
            outcome = .sent
        } else {
            switch ObservationDelivery.classify(errorCode: errorCode) {
            case .peerAbsent: outcome = .peerAbsent
            case .congested: outcome = .congested
            }
        }
        stateLock.lock()
        peerBelief.onTrafficSend(outcome)
        stateLock.unlock()
    }

    /// 只在对端可达时发：不可达期发了也是 ENOENT；对端回来后下一帧就是完整窗口，无需补发。
    func emitSessionStats(_ stats: SessionStats) {
        stateLock.lock()
        let reachable = peerBelief.reachable
        stateLock.unlock()
        guard reachable else { return }
        _ = send(ObservationFrameCodec.encode(.sessionStats(stats)))
    }

    func emitLog(_ line: LogLine) {
        guard EngineLogPolicy.accepts(line.level) else { return }
        let bounded = LogLine(level: line.level, message: EngineLogPolicy.truncate(line.message))
        stateLock.lock()
        guard peerBelief.shouldBufferLogs else {
            stateLock.unlock()
            return
        }
        pendingLogs.append(bounded)
        stateLock.unlock()
        scheduleLogFlushIfNeeded()
    }

    func emitGroups(_ groups: [NodeGroup]) {
        // 先落快照再发代号：UI 收到 invalidation 时文件必已就位（原子替换）。
        // 串行队列保次序；teardown 后在飞的快照随 weak self 静默丢弃（观察数据可丢）。
        // 不可达期整体短路:对端回归后全量由 UI 快照索取(provider message)补齐。
        snapshotQueue.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let gateOpen = self.peerBelief.shouldEmitGroups
            self.stateLock.unlock()
            guard gateOpen, self.writeSnapshot(groups) else { return }
            self.stateLock.lock()
            self.groupsGeneration &+= 1
            let current = self.groupsGeneration
            self.stateLock.unlock()
            self.send(ObservationFrameCodec.encode(.groupsInvalidation(generation: current)))
        }
    }

    // MARK: - 传输

    private func flushPendingLogs() {
        stateLock.lock()
        let lines = pendingLogs.drain(maxEntries: ObservationFrameCodec.maxLogBatchEntries)
        logFlushScheduled = false
        logBatchGeneration &+= 1
        let generation = logBatchGeneration
        stateLock.unlock()

        guard let batch = ObservationFrameCodec.encodeLogBatch(lines[...], generation: generation) else { return }

        let unsentLines = lines.dropFirst(batch.entryCount)
        if !unsentLines.isEmpty {
            stateLock.lock()
            pendingLogs.prepend(unsentLines)
            stateLock.unlock()
        }
        for datagram in batch.datagrams {
            guard send(datagram) else { break }
        }
        scheduleLogFlushIfNeeded()
    }

    private func scheduleLogFlushIfNeeded() {
        stateLock.lock()
        let shouldSchedule = pendingLogs.count > 0 && !logFlushScheduled
        if shouldSchedule { logFlushScheduled = true }
        stateLock.unlock()
        guard shouldSchedule else { return }
        logFlushQueue.asyncAfter(deadline: .now() + Self.logFlushDelay) { [weak self] in
            self?.flushPendingLogs()
        }
    }

    @discardableResult
    private func send(_ data: Data) -> Bool {
        sendReturningErrno(data).0
    }

    private func sendReturningErrno(_ data: Data) -> (Bool, Int32) {
        sendLock.lock()
        defer { sendLock.unlock() }
        guard let errorCode = outlet.send(data) else {
            // 从失败恢复同样要留痕：只记「开始丢」不记「不丢了」，日志里就永远看不出丢了多久。
            if dropStreakCount > 0 {
                logger.error(
                    """
                    observation frame delivery recovered after \(self.dropStreakCount, privacy: .public) drops
                    """
                )
                dropStreakCount = 0
                dropStreakErrorCode = 0
            }
            return (true, 0)
        }
        // UI 未连（归类见 `ObservationDelivery`）与缓冲满（EWOULDBLOCK/ENOBUFS）都属预期：丢帧即可。
        //
        // 记法按「连续条纹」而不是「一辈子只记一次」：只记一次的话，故障发生时那一行早已用掉，
        // 全程零留痕。errno 变化即记、其后按计数汇总，档位 error（debug 档默认不持久化）。
        // 限流仍在：观察通道故障不该淹没隧道日志。
        if errorCode != dropStreakErrorCode {
            dropStreakErrorCode = errorCode
            dropStreakCount = 1
            logger.error(
                """
                observation frame dropped: \(String(cString: strerror(errorCode)), privacy: .public) \
                (errno \(errorCode, privacy: .public))
                """
            )
        } else {
            dropStreakCount &+= 1
            if dropStreakCount % Self.dropReportInterval == 0 {
                logger.error(
                    """
                    observation frame dropped ×\(self.dropStreakCount, privacy: .public): \
                    \(String(cString: strerror(errorCode)), privacy: .public)
                    """
                )
            }
        }
        return (false, errorCode)
    }

    private func writeSnapshot(_ groups: [NodeGroup]) -> Bool {
        do {
            try GroupsSnapshotCodec.encode(groups).write(to: snapshotUrl, options: .atomic)
            return true
        } catch {
            logger.error("groups snapshot write failed: \(describe(error), privacy: .public)")
            return false
        }
    }
}
