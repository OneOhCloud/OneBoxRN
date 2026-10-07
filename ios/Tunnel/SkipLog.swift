import Core
import Foundation

/// 一种跳过的成因：日志里的名字与级别。
protocol SkipCause: Equatable {
    var token: String { get }
    var level: LogLevel { get }
}

/// 一条事件流的跳过记账：`SkipStreak` 每交出一次迁移写一行，其余跳过只计数。
///
/// 写日志留在锁内：两个线程各自拿到一次迁移、却在锁外交错写出，读日志的人会看到「结束」排在
/// 「开始」前面。
final class SkipLog<Cause: SkipCause>: @unchecked Sendable {
    private let stream: String
    private let write: @Sendable (LogLine) -> Void
    private let lock = NSLock()
    private var streak = SkipStreak<Cause>()

    init(stream: String, write: @escaping @Sendable (LogLine) -> Void) {
        self.stream = stream
        self.write = write
    }

    /// `detail` 只在这一段开始或新成因出现的那一行里出现。
    func skip(_ cause: Cause, detail: String = "") {
        lock.lock()
        defer { lock.unlock() }
        let suffix = detail.isEmpty ? "" : " (\(detail))"
        switch streak.skip(cause) {
        case nil, .ended:
            return
        case .began(let cause):
            write(LogLine(level: cause.level, message: "\(stream) events skipped: \(cause.token)\(suffix)"))
        case .newCause(let cause):
            write(LogLine(level: cause.level, message: "\(stream) events also skipped: \(cause.token)\(suffix)"))
        }
    }

    /// 这条流的事件又放行了（交到了下一站）。
    func delivered() {
        end { "\(stream) events pass again after \($0)" }
    }

    /// 会话结束：还没结束的那一段带着计数收尾，跳过的次数一条不少。
    func close() {
        end { "\(stream) skips closed with the session after \($0)" }
    }

    private func end(_ message: (String) -> String) {
        lock.lock()
        defer { lock.unlock() }
        guard case .ended(let summary)? = streak.end() else { return }
        let perCause = summary.counts.map { "\($0.cause.token)=\($0.count)" }.joined(separator: " ")
        // 取本段最重的级别：warn 成因的次数不能跟着一条 debug 汇总一起被滤掉。
        let level = summary.counts.map(\.cause.level).max() ?? .debug
        write(LogLine(
            level: level,
            message: message("\(summary.total) skipped (\(perCause); cause changes \(summary.causeChanges))")
        ))
    }
}
