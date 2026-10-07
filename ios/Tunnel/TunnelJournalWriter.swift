import Core
import Darwin
import Foundation
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.tunnel", category: "TunnelJournal")

/// 隧道运行期日志的唯一写端（`TunnelJournal` 定格式与判定）。
///
/// 写入全走一个串行队列、常开句柄追加；调用线程（含引擎日志回调线程）只投递，格式化与 IO
/// 都在队列上。写失败只落 os_log、不崩——观察面故障不升级成数据面故障。
final class TunnelJournalWriter: @unchecked Sendable {
    static let shared = TunnelJournalWriter()

    /// 体征间隔：够密，被杀前最后一行离死亡时刻不超过半分钟；又不至于把日志刷成体征流水。
    private static let vitalsInterval: DispatchTimeInterval = .seconds(30)

    /// 队列里最多积压这么多条：告警风暴下超出的丢弃并计数，不让日志拖出无界内存。
    private static let maxPending = 512

    private let queue = DispatchQueue(label: "cloud.oneoh.networktools.tunnel.journal", qos: .utility)
    private let pendingLock = NSLock()
    private var pending = 0
    private var dropped = 0

    // 以下只在 `queue` 上读写。
    private var handle: FileHandle?
    private var currentBytes = 0
    private var sessionBeginLine: String?
    private var vitalsTimer: DispatchSourceTimer?
    private var pressureSource: DispatchSourceMemoryPressure?

    private init() {}

    func record(_ event: TunnelJournal.Event, _ detail: String = "") {
        let date = Date()
        guard admit() else { return }
        queue.async {
            self.release()
            self.writeDroppedNotice()
            self.append(TunnelJournal.line(at: date, event: event, detail: detail))
        }
    }

    /// 停止回调返回后进程随时可能被回收，结束行要尽量在返回前落盘；但等待有上界，
    /// 不能为了一行日志拖住撤销网络设置——调用方把这段等待计入自己的拆除预算。
    func recordNow(_ event: TunnelJournal.Event, _ detail: String = "", budget: DispatchTimeInterval) {
        let date = Date()
        let written = DispatchSemaphore(value: 0)
        queue.async {
            self.append(TunnelJournal.line(at: date, event: event, detail: detail))
            if event == .sessionEnd { self.sessionBeginLine = nil }
            written.signal()
        }
        if written.wait(timeout: .now() + budget) == .timedOut {
            logger.error("journal \(event.rawValue, privacy: .public) not flushed within budget")
        }
    }

    /// 会话开始沿：先判定上一个会话怎么结束的——被杀的会话没有机会自己写结束行，
    /// 只能由下一个会话替它补上——再落本次的开始行。
    func beginSession(_ detail: String) {
        queue.sync {
            do {
                let previous = TunnelJournal.lastSessionEnding(in: try TunnelJournal.readAll(files: ContainerTunnelFiles(base: EnginePaths.base())))
                if case .unexpected(let beganAt, let lastRecordAt, let lastVitals) = previous {
                    append(TunnelJournal.line(
                        at: Date(),
                        event: .sessionEnd,
                        detail: "previous session \(beganAt) ended without stop callback; "
                            + "last record \(lastRecordAt); last vitals: \(lastVitals ?? "none")"
                    ))
                }
            } catch {
                // 读不全就不下结论：宁可不判，也不把一次读失败报成「上个会话被杀」。
                append(TunnelJournal.line(at: Date(), event: .journal, detail: "unreadable: \(describe(error))"))
            }
            let line = TunnelJournal.line(at: Date(), event: .sessionBegin, detail: detail)
            sessionBeginLine = line
            append(line)
        }
    }

    /// 连上之后开始体征采样与内存压力记录。
    func startMonitoring() {
        queue.async {
            self.cancelMonitoring()
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now() + Self.vitalsInterval, repeating: Self.vitalsInterval)
            // 进程级单例，强引用不构成泄漏；源被 cancel 时处理闭包随之释放。
            timer.setEventHandler {
                self.append(TunnelJournal.line(at: Date(), event: .vitals, detail: TunnelVitals.sample().description))
            }
            timer.resume()
            self.vitalsTimer = timer

            let pressure = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: self.queue)
            pressure.setEventHandler { [weak pressure] in
                guard let pressure else { return }
                let level = pressure.data.contains(.critical) ? "critical" : "warning"
                self.append(TunnelJournal.line(
                    at: Date(),
                    event: .memoryPressure,
                    detail: "level=\(level) \(TunnelVitals.sample().description)"
                ))
            }
            pressure.resume()
            self.pressureSource = pressure
        }
    }

    func stopMonitoring() {
        queue.async { self.cancelMonitoring() }
    }

    // MARK: - 投递计数

    private func admit() -> Bool {
        pendingLock.lock()
        defer { pendingLock.unlock() }
        guard pending < Self.maxPending else {
            dropped += 1
            return false
        }
        pending += 1
        return true
    }

    private func release() {
        pendingLock.lock()
        pending -= 1
        pendingLock.unlock()
    }

    // MARK: - 队列内

    private func writeDroppedNotice() {
        pendingLock.lock()
        let count = dropped
        dropped = 0
        pendingLock.unlock()
        guard count > 0 else { return }
        append(TunnelJournal.line(at: Date(), event: .journal, detail: "dropped \(count) records (backlog full)"))
    }

    private func cancelMonitoring() {
        vitalsTimer?.cancel()
        vitalsTimer = nil
        pressureSource?.cancel()
        pressureSource = nil
    }

    private func append(_ line: String) {
        let data = Data(line.utf8)
        if TunnelJournal.shouldRotate(currentBytes: currentBytes, appendingBytes: data.count) {
            rotate()
        }
        write(data)
    }

    private func write(_ data: Data) {
        guard let handle = openedHandle() else { return }
        do {
            try handle.write(contentsOf: data)
            currentBytes += data.count
        } catch {
            logger.error("journal write failed: \(describe(error), privacy: .public)")
            closeHandle()
        }
    }

    private func openedHandle() -> FileHandle? {
        if let handle { return handle }
        let url = AppGroupPaths.tunnelJournalURLs().current
        let fileManager = FileManager.default
        do {
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !fileManager.fileExists(atPath: url.path) {
                guard fileManager.createFile(atPath: url.path, contents: nil) else {
                    logger.error("journal create failed at \(url.path, privacy: .public)")
                    return nil
                }
            }
            let opened = try FileHandle(forWritingTo: url)
            currentBytes = Int(try opened.seekToEnd())
            handle = opened
            return opened
        } catch {
            logger.error("journal open failed: \(describe(error), privacy: .public)")
            return nil
        }
    }

    /// 轮转后把本会话的开始行原样补写在新文件开头：连续两次轮转会删掉原开始行，
    /// 没有它，判定就认不出这段会话，被杀了也报不出来。
    private func rotate() {
        closeHandle()
        let urls = AppGroupPaths.tunnelJournalURLs()
        let fileManager = FileManager.default
        do {
            if fileManager.fileExists(atPath: urls.rotated.path) {
                try fileManager.removeItem(at: urls.rotated)
            }
            try fileManager.moveItem(at: urls.current, to: urls.rotated)
        } catch {
            logger.error("journal rotate failed: \(describe(error), privacy: .public)")
        }
        currentBytes = 0
        if let sessionBeginLine { write(Data(sessionBeginLine.utf8)) }
    }

    private func closeHandle() {
        do {
            try handle?.close()
        } catch {
            logger.error("journal close failed: \(describe(error), privacy: .public)")
        }
        handle = nil
    }
}

/// 扩展进程的一拍体征。内存取 `phys_footprint`：iOS 对扩展执行内存上限时计量的正是它。
struct TunnelVitals: CustomStringConvertible {
    let footprintBytes: UInt64
    let footprintPeakBytes: UInt64
    let availableBytes: UInt64
    let traffic: Traffic?

    static func sample() -> TunnelVitals {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        let ok = result == KERN_SUCCESS
        return TunnelVitals(
            footprintBytes: ok ? info.phys_footprint : 0,
            footprintPeakBytes: ok ? UInt64(info.ledger_phys_footprint_peak) : 0,
            availableBytes: availableMemory(),
            traffic: MonitorHub.shared.snapshot().traffic
        )
    }

    private static func availableMemory() -> UInt64 {
        UInt64(os_proc_available_memory())
    }

    var description: String {
        var parts = [
            "footprint_mib=\(Self.mib(footprintBytes))",
            "peak_mib=\(Self.mib(footprintPeakBytes))",
            "available_mib=\(Self.mib(availableBytes))",
        ]
        if let traffic {
            parts.append("conn_in=\(traffic.connIn) conn_out=\(traffic.connOut)")
            parts.append("up_total=\(traffic.upTotal) down_total=\(traffic.downTotal)")
        }
        return parts.joined(separator: " ")
    }

    private static func mib(_ bytes: UInt64) -> String {
        String(format: "%.1f", Double(bytes) / 1_048_576)
    }
}
