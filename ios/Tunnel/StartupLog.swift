import Core
import Foundation

// 启动期引擎日志落盘（:tun 侧）。
//
// 存在的理由：引擎日志的正常去向是观察通道，而通道在引擎起来**之后**才建立
// （见 EngineBinding.start）。于是启动失败这一最需要日志的场景，恰恰一行都留不下——
// `start_error.txt` 只有最终那句错误，`start_stage.txt` 只有到达的阶段名，中间过程全黑。
// 宿主的 os_log 也不总是可取（无人值守环境下 `log show` 可能读不到日志库）。
//
// 故启动期把引擎日志全量写一份到 App Group：每次启动截断重来，连上后停止追加
// （运行期由 `TunnelJournalWriter` 只记告警以上与生命周期），并设字节上限防跑飞。
enum StartupLog {

    /// 单次启动最多留这么多字节：够覆盖装配全过程，又不会在失败风暴下把容器写满。
    private static let byteCap = 512 * 1024

    private static let lock = NSLock()
    nonisolated(unsafe) private static var written = 0
    nonisolated(unsafe) private static var recording = false

    /// 启动开始：截断旧内容并开始记录。
    static func begin() {
        lock.lock()
        defer { lock.unlock() }
        written = 0
        recording = true
        try? FileManager.default.createDirectory(
            at: AppGroupPaths.diagnosticsDirectory(),
            withIntermediateDirectories: true
        )
        // **原子**：读方那一拍不得拿到半份。这里写的是空 Data（截断），
        // 原子替换让读方要么看到旧的完整一份、要么看到空的一份，**不会看到写到一半的**。
        try? Data().write(to: AppGroupPaths.startupLogURL(), options: .atomic)
    }

    /// 启动成功：停止追加（运行期改由 `TunnelJournalWriter` 记录）。
    static func end() {
        lock.lock()
        defer { lock.unlock() }
        recording = false
    }

    static func append(_ line: LogLine) {
        lock.lock()
        defer { lock.unlock() }
        guard recording, written < byteCap else { return }
        guard let data = StartupLogFormat.line(line).data(using: .utf8) else { return }
        written += data.count
        let url = AppGroupPaths.startupLogURL()
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }
}
