import Foundation
import Core

/// 采样器的两个时钟：提交节拍取单调时钟，小时归属取墙钟。混用会让两条语义互相污染。
struct UsageClock: Sendable {
    var elapsedRealtimeMillis: @Sendable () -> Int64 = { MonotonicClock.millis() }
    var epochSeconds: @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970) }
}

/// 一个配置的两份记录文件；文件名经 core 的形态校验产出（防路径穿越）。
struct UsageRecordFiles: Sendable {
    let history: URL
    let pending: URL

    static func of(directory: URL, profileId: String) -> UsageRecordFiles {
        UsageRecordFiles(
            history: directory.appendingPathComponent(UsageHistory.historyFileName(profileId)),
            pending: directory.appendingPathComponent(UsageHistory.pendingFileName(profileId))
        )
    }
}

/// 隧道扩展内的用量采样器。与 Android tunnel/UsageRecorder.kt 逐字对应。
///
/// 线程分工：`observe` 在引擎 FFI 回调线程（任意后台线程）只做锁内的累计器算术；
/// 一切序列化与文件替换投递到专用串行队列——回调线程处在数据面上，绝不能在那里做 IO。
/// IO 失败只落诊断，不回抛（统计是辅助面，其故障不得拖累转发）。
final class UsageRecorder: @unchecked Sendable {
    private struct Commit {
        let hourUtc: Int64
        let up: Int64
        let down: Int64
    }

    private let files: UsageRecordFiles
    private let clock: UsageClock
    private let onDiagnostic: @Sendable (String) -> Void
    private let queue = DispatchQueue(label: "cloud.oneoh.networktools.usage-recorder", qos: .utility)
    private let lock = NSLock()

    /// 只在 `lock` 内访问。
    private var accumulator = UsageAccumulator.empty

    /// 关闭后到达的帧属于已停止的会话：直接丢弃，不再入队（与 Android 同形）。
    private var closed = false

    /// 以下两项只在串行队列上访问，故无需加锁。
    private var history: UsageHistory?
    private var pending: UsagePending?

    init(
        files: UsageRecordFiles,
        clock: UsageClock = UsageClock(),
        onDiagnostic: @escaping @Sendable (String) -> Void = { _ in }
    ) {
        self.files = files
        self.clock = clock
        self.onDiagnostic = onDiagnostic
    }

    func observe(_ traffic: Traffic) {
        let now = clock.elapsedRealtimeMillis()
        lock.lock()
        guard !closed else {
            lock.unlock()
            return
        }
        accumulator = accumulator.observing(
            atMillis: now,
            upTotal: max(traffic.upTotal, 0),
            downTotal: max(traffic.downTotal, 0)
        )
        let commit = accumulator.shouldCommit(atMillis: now) ? takeCommit(now) : nil
        lock.unlock()
        if let commit { submit(commit) }
    }

    /// 停止沿补提交：不等下一分钟，把剩余待提交量落盘。
    func flush() {
        lock.lock()
        let commit = accumulator.hasPending ? takeCommit(clock.elapsedRealtimeMillis()) : nil
        lock.unlock()
        if let commit { submit(commit) }
    }

    /// 停止沿收尾：补提交后**等**队列排空——进程可能紧接着就没了，不等于把最后一次写丢掉。
    /// 与 Android `close()` 同形。
    func close() {
        flush()
        lock.lock()
        closed = true
        lock.unlock()
        queue.sync {}
    }

    /// 调用方已持 `lock`。
    private func takeCommit(_ now: Int64) -> Commit {
        let commit = Commit(
            hourUtc: UsageHistory.hour(ofEpochSeconds: clock.epochSeconds()),
            up: accumulator.pendingUp,
            down: accumulator.pendingDown
        )
        accumulator = accumulator.committed(atMillis: now)
        return commit
    }

    private func submit(_ commit: Commit) {
        queue.async { [self] in
            do {
                try apply(commit)
            } catch {
                onDiagnostic("usage record failed: \(error)")
            }
        }
    }

    private func apply(_ commit: Commit) throws {
        let loaded = try ensureLoaded(currentHour: commit.hourUtc)
        if let current = pending {
            if commit.hourUtc <= current.hourUtc {
                // 同一小时，或墙钟回拨到更早的小时：都记进当前这份，不另起一段。
                pending = UsagePending(
                    hourUtc: current.hourUtc,
                    up: current.up + commit.up,
                    down: current.down + commit.down
                )
            } else {
                // 跨小时：先把上一个完整小时折进环并落盘，`.bin` 的 lastHourUtc 因此推进，
                // 旧 sidecar 即便残留也会被读侧的严格判据忽略（防重复计入）。
                //
                // **先写盘、后发布内存态**：反过来的话，写失败会留下「内存已折、盘上未折」的状态，
                // 下一次提交再折一次同一个小时，那一小时就被记了两遍（失败只该丢本次提交）。
                let folded = loaded.recording(hourUtc: current.hourUtc, up: current.up, down: current.down)
                try writeAtomically(folded.encode(), to: files.history)
                history = folded
                pending = UsagePending(hourUtc: commit.hourUtc, up: commit.up, down: commit.down)
            }
        } else {
            pending = UsagePending(hourUtc: commit.hourUtc, up: commit.up, down: commit.down)
        }
        if let pending {
            try writeAtomically(pending.encode(), to: files.pending)
        }
    }

    private func ensureLoaded(currentHour: Int64) throws -> UsageHistory {
        if let history { return history }
        var directory = files.history.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // 在**创建处**就排除备份——留给读侧补标会留下一个「已有数据但尚未标记」的窗口。
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)
        evictOldestBeforeCreating(in: directory)
        var loaded = readHistory()
        history = loaded

        // 上一会话遗留的 sidecar 有三种处置：已折进环（折盘后进程被杀）→ 丢弃，否则那一小时会被记两遍；
        // 属于更早的完整小时 → 折进环；就是当前小时 → 接着累加，不丢这一段。
        if let stored = readPending() {
            if stored.hourUtc <= loaded.lastHourUtc {
                pending = nil
            } else if stored.hourUtc >= currentHour {
                pending = stored
            } else {
                loaded = loaded.recording(hourUtc: stored.hourUtc, up: stored.up, down: stored.down)
                history = loaded
                try writeAtomically(loaded.encode(), to: files.history)
                pending = nil
            }
        }
        return loaded
    }

    /// 创建第 193 份记录前先淘汰最旧的一份。
    ///
    /// 上限必须在**创建处**执行——只靠 App 侧回收，两次回收之间就能长出第 193 份，
    /// 「目录恒 ≤ 20 MB」那条不变量就成了「多数时候成立」。
    private func evictOldestBeforeCreating(in directory: URL) {
        let manager = FileManager.default
        guard !manager.fileExists(atPath: files.history.path) else { return }
        guard let entries = try? manager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }
        let histories = entries.filter { $0.pathExtension == "bin" }
        guard histories.count >= UsageHistory.maxRecords else { return }

        let oldestFirst = histories.sorted { left, right in
            modifiedAt(left) < modifiedAt(right)
        }
        for url in oldestFirst.prefix(histories.count - UsageHistory.maxRecords + 1) {
            try? manager.removeItem(at: url)
            let id = url.deletingPathExtension().lastPathComponent
            if UsageHistory.isValidRecordId(id) {
                try? manager.removeItem(at: directory.appendingPathComponent(UsageHistory.pendingFileName(id)))
            }
            onDiagnostic("usage record evicted: record limit reached")
        }
    }

    private func modifiedAt(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    private func readHistory() -> UsageHistory {
        guard let data = try? Data(contentsOf: files.history) else { return UsageHistory.empty }
        guard case .loaded(let value) = UsageHistory.decode(data) else {
            // 损坏/版本不识别：丢弃重建，不崩隧道（fail-fast 的显式例外）。
            onDiagnostic("usage history unreadable, rebuilding")
            return UsageHistory.empty
        }
        return value
    }

    private func readPending() -> UsagePending? {
        guard let data = try? Data(contentsOf: files.pending) else { return nil }
        guard case .loaded(let value) = UsagePending.decode(data) else {
            onDiagnostic("usage sidecar unreadable, dropping")
            return nil
        }
        return value
    }

    /// 原子替换：单写者 + 原子写，读者永不见半份文件。
    private func writeAtomically(_ data: Data, to target: URL) throws {
        try data.write(to: target, options: .atomic)
    }
}
