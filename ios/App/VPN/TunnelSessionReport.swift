import Foundation
import Core

/// 把隧道上一个会话的结局写进日志页。
///
/// 隧道被系统杀掉时，App 这边只看得到「断开了」；为什么断、断之前扩展是什么状态，只有隧道
/// 落盘的运行期日志知道。在断开沿读一次，用户打开日志页就能看到结论，不必再去设备上取文件。
@MainActor
final class TunnelSessionReport {
    private let logStore: LogStore
    private let journalText: @Sendable () throws -> String
    /// 已报告过的会话（以开始时刻标识）：同一次断开会先后经过 disconnecting / disconnected，
    /// App 冷启动时也会再读到同一个会话，不重复写。
    private var reportedSession: String?

    init(
        logStore: LogStore,
        journalText: @escaping @Sendable () throws -> String = { try TunnelJournal.readAll(files: TunnelFileAccess.current) }
    ) {
        self.logStore = logStore
        self.journalText = journalText
    }

    /// 只在隧道不在运行时调用：运行中的会话同样没有结束行，会被误判成「被杀」。
    ///
    /// 读文件与解析放到后台：日志最多约 2 MiB，而调用点在状态发布路径上。
    func reportLastSession() {
        let journalText = journalText
        Task.detached(priority: .utility) { [weak self] in
            let ending = Result { TunnelJournal.lastSessionEnding(in: try journalText()) }
            await self?.publish(ending)
        }
    }

    private func publish(_ ending: Result<SessionEnding, Error>) {
        switch ending {
        case .failure(let error):
            append(level: .warn, "tunnel journal unreadable, last session not judged: \(describe(error))")
        case .success(.none):
            return
        case .success(.ended(let beganAt, let detail)):
            guard markReported(beganAt) else { return }
            append(
                level: TunnelJournal.isUserStop(detail) ? .info : .warn,
                "tunnel session \(beganAt) ended: \(detail)"
            )
        case .success(.unexpected(let beganAt, let lastRecordAt, let lastVitals)):
            guard markReported(beganAt) else { return }
            append(
                level: .error,
                "tunnel session \(beganAt) ended without a stop callback (killed or crashed); "
                    + "last record \(lastRecordAt); last vitals: \(lastVitals ?? "none")"
            )
        }
    }

    private func append(level: LogLevel, _ message: String) {
        logStore.append(source: .app, level: level, message: message)
    }

    private func markReported(_ session: String) -> Bool {
        guard session != reportedSession else { return false }
        reportedSession = session
        return true
    }
}
