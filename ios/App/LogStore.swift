import Foundation
import Observation
import Core

/// 日志来源两值（中立命名）：引擎核心 / 应用层（隧道控制与服务事件 + 动作层事件）。
enum LogSource: CaseIterable, Sendable {
    case engine
    case app
}

/// 单条日志（时间、来源、级别、文本）；id 跨源单调，快照按 id 归并，逐出后列表身份仍稳定。
struct LogEntry: Identifiable, Equatable, Sendable {
    let id: UInt64
    let time: Date
    let source: LogSource
    let level: LogLevel
    let message: String

    /// 错误级判定（`error` 及以上）。
    var isError: Bool { level >= .error }
}

/// 已完成入储策略处理、等待批量提交的日志。接收时刻用于清空与迟到批次之间的边界判断。
struct PendingLogEntry: Sendable {
    let receivedAt: ContinuousClock.Instant
    let time: Date
    let source: LogSource
    let level: LogLevel
    let message: String
    let storageByteCount: Int

    fileprivate init(source: LogSource, level: LogLevel, message: String) {
        receivedAt = ContinuousClock.now
        time = Date()
        self.source = source
        self.level = level
        self.message = message
        storageByteCount = message.utf8.count
    }
}

// 两源日志的唯一内存缓冲（两端同名 LogStore，全仓仅此一份组件）：
// 按来源各一环、容量各 1000（分源逐出——引擎行高频不逐稀疏应用行）；ENGINE 行入储前
// 剥 ANSI SGR且低于 info 直接丢弃（常量门槛：上游对 platform 通道全量推送）。
// 除追加与清空外无操作改动缓冲；过滤与跟随只作用于呈现层（LogsViewModel）。
@MainActor
@Observable
final class LogStore {
    /// 每源环形容量的单一来源。
    nonisolated static let capacity = 1000

    /// 对外只发布**版本**，不发布任何列表——呈现只消费单一来源，跨源归并列表从未被
    /// 整体使用过（消费方只有「按来源过滤」与 `isEmpty`）。版本推进后由呈现层按当前来源拉快照；
    /// 页面不在场时洪峰只推进计数。
    ///
    /// 且**按来源各一份**：呈现同时只看一个来源（两段互斥），共用一个版本会让另一源的
    /// 批次白白使当前投影失效、重建一份最多 1000 元素的数组——引擎洪峰下是每秒十次的无用分配。
    private(set) var engineVersion: UInt64 = 0
    private(set) var appVersion: UInt64 = 0
    @ObservationIgnored private var engineEntries: [LogEntry] = []
    @ObservationIgnored private var appEntries: [LogEntry] = []
    @ObservationIgnored private var nextId: UInt64 = 0
    @ObservationIgnored private var clearBoundary: ContinuousClock.Instant?
    @ObservationIgnored private var publicationTask: Task<Void, Never>?
    /// 发布窗口的代际：归还闸门时据此确认归还的是**自己**那一次占用（见 `schedulePublication`）。
    @ObservationIgnored private var publicationGeneration: UInt64 = 0
    /// 待发布的来源：发布窗口内哪几源有新行，到点只推进这几源的版本。
    @ObservationIgnored private var pendingSources: Set<LogSource> = []

    private static let publicationInterval: Duration = .milliseconds(100)

    func append(source: LogSource, level: LogLevel, message: String) {
        guard let pending = Self.prepareForStorage(source: source, level: level, message: message) else { return }
        appendBatch([pending])
    }

    /// 批量提交只做一次容量整理，并把可观察快照发布频率限制为最多 10 Hz。
    func appendBatch(_ pendingEntries: [PendingLogEntry]) {
        guard !pendingEntries.isEmpty else { return }

        var appended = false
        for pending in pendingEntries {
            if let clearBoundary, pending.receivedAt <= clearBoundary { continue }
            // PendingLogEntry 只能经 prepareForStorage 创建；此处保留不变量守卫，避免后续入口绕过入储门槛。
            if pending.source == .engine && !EngineLogPolicy.accepts(pending.level) { continue }

            let entry = LogEntry(
                id: nextId,
                time: pending.time,
                source: pending.source,
                level: pending.level,
                message: pending.message
            )
            nextId += 1
            switch pending.source {
            case .engine: engineEntries.append(entry)
            case .app: appEntries.append(entry)
            }
            pendingSources.insert(pending.source)
            appended = true
        }
        guard appended else { return }

        retainNewestEntries(&engineEntries)
        retainNewestEntries(&appEntries)
        schedulePublication()
    }

    /// 清空全部缓冲（过滤保持当前段，呈现层零动作）。
    func clear() {
        let pendingTask = publicationTask
        publicationTask = nil
        pendingTask?.cancel()
        clearBoundary = ContinuousClock.now
        engineEntries = []
        appEntries = []
        pendingSources.removeAll()
        // 清空必须立即发布，不等 100 ms 窗口；两源都清空故两源都推进。
        for source in LogSource.allCases { bumpVersion(of: source) }
    }

    /// 呈现层的版本读取口：只观察自己那一源，别源的批次不触发重算。
    func version(of source: LogSource) -> UInt64 {
        switch source {
        case .engine: return engineVersion
        case .app: return appVersion
        }
    }

    private func bumpVersion(of source: LogSource) {
        switch source {
        case .engine: engineVersion &+= 1
        case .app: appVersion &+= 1
        }
    }

    /// 按来源取一份快照。非可观察读取：调用方已经因 `version` 变化而重算。
    func snapshot(source: LogSource) -> [LogEntry] {
        switch source {
        case .engine: return engineEntries
        case .app: return appEntries
        }
    }

    /// 两环是否都空。避免为这一个布尔量去物化整份列表。
    var isEmpty: Bool {
        // 参与观察：任一源变化都可能改变判空结果。
        _ = engineVersion
        _ = appVersion
        return engineEntries.isEmpty && appEntries.isEmpty
    }

    /// 在回调线程完成级别过滤和 ANSI 清理，避免低级别洪水进入队列或占用 MainActor。
    nonisolated static func prepareForStorage(
        source: LogSource,
        level: LogLevel,
        message: String
    ) -> PendingLogEntry? {
        if source == .engine && !EngineLogPolicy.accepts(level) { return nil }
        let text = source == .engine
            ? EngineLogPolicy.truncate(stripSgr(message))
            : message
        return PendingLogEntry(source: source, level: level, message: text)
    }

    private func retainNewestEntries(_ buffer: inout [LogEntry]) {
        let excess = buffer.count - Self.capacity
        if excess > 0 { buffer.removeFirst(excess) }
        // 环形缓冲不变量破坏 → 立即崩溃。
        precondition(buffer.count <= Self.capacity, "log ring buffer exceeded capacity")
    }

    private func schedulePublication() {
        guard publicationTask == nil else { return }
        publicationGeneration &+= 1
        let generation = publicationGeneration
        publicationTask = Task { @MainActor [weak self] in
            // 闸门必须在**每条**退出路径上归还,取消沿也不例外:漏掉它,`publicationTask` 就永远
            // 非 nil,此后所有追加都排不上发布,日志页永久停更。
            defer { self?.releasePublicationSlot(generation: generation) }
            try? await Task.sleep(for: Self.publicationInterval)
            guard let self, !Task.isCancelled else { return }
            for source in pendingSources { bumpVersion(of: source) }
            pendingSources.removeAll()
        }
    }

    /// 代际判据保证只归还自己那一次占用——`clear()` 之后新排的那次不会被上一次的收尾误清。
    private func releasePublicationSlot(generation: UInt64) {
        guard publicationGeneration == generation else { return }
        publicationTask = nil
    }


    // 剥 ANSI SGR 转义序列（ESC[…m）。着色不引入——语义色只表达状态，故剥离而非逐 span 解析着色。
    nonisolated private static func stripSgr(_ text: String) -> String {
        let scalars = text.unicodeScalars
        var output = String.UnicodeScalarView()
        output.reserveCapacity(scalars.count)
        var cursor = scalars.startIndex

        while cursor < scalars.endIndex {
            let scalar = scalars[cursor]
            guard scalar.value == 0x1B else {
                output.append(scalar)
                cursor = scalars.index(after: cursor)
                continue
            }

            let bracket = scalars.index(after: cursor)
            guard bracket < scalars.endIndex, scalars[bracket].value == 0x5B else {
                output.append(scalar)
                cursor = bracket
                continue
            }

            var end = scalars.index(after: bracket)
            var foundTerminator = false
            while end < scalars.endIndex {
                let value = scalars[end].value
                if value == 0x6D {
                    cursor = scalars.index(after: end)
                    foundTerminator = true
                    break
                }
                if value != 0x3B && !(0x30...0x39).contains(value) { break }
                end = scalars.index(after: end)
            }
            if !foundTerminator {
                output.append(scalar)
                cursor = bracket
            }
        }
        return String(output)
    }
}
