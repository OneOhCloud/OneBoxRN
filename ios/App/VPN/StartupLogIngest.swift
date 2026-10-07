import Foundation
import Core

/// 启动期引擎日志的回读（隧道进程写、App 读）。
///
/// 引擎日志的正常去向是观察通道，而通道要等引擎 `started` 才建
/// （`MonitorBinding.installChannel` 的 `status == .started` 门）。于是启动失败这一
/// 最需要日志的场景，只有隧道侧落盘的 `startup.log`（`Tunnel/StartupLog`）里有，
/// 本件把它读回来。
///
/// 增量回读：只取上次之后新增的字节；文件在每次启动沿被截断，故读到的长度比已读的短就说明
/// 换了一段会话，从头再来。**不消费没有换行结尾的尾巴**——写侧正在追加，半行读进来就会被
/// 当成一整行，下一拍剩下的半行又成另一行。
@MainActor
final class StartupLogIngest {
    private let logStore: LogStore
    private let files: any TunnelFiles
    private var ingestedBytes = 0

    init(
        logStore: LogStore,
        files: any TunnelFiles = TunnelFileAccess.current
    ) {
        self.logStore = logStore
        self.files = files
    }

    /// 把新增的行喂进 `ENGINE` 段。可重复调用——启动等待循环里每拍调一次即近实时。
    func ingest() {
        // 读不到（还没有这次启动的日志、或暂时读不到）就等下一拍：本件是近实时回读，不是唯一证据。
        guard let data = try? files.read(.startupLog) else { return }
        // 比已读的还短 = 隧道侧截断重来（新的一次启动），偏移归零。
        if data.count < ingestedBytes { ingestedBytes = 0 }
        guard data.count > ingestedBytes else { return }

        let fresh = data.subdata(in: ingestedBytes..<data.count)
        guard let newline = fresh.lastIndex(of: UInt8(ascii: "\n")) else { return }
        let complete = fresh.subdata(in: 0..<(newline + 1))
        ingestedBytes += complete.count

        guard let block = String(data: complete, encoding: .utf8) else { return }
        let entries = StartupLogFormat.parse(block: block).compactMap {
            LogStore.prepareForStorage(source: .engine, level: $0.level, message: $0.message)
        }
        guard !entries.isEmpty else { return }
        logStore.appendBatch(entries)
    }

    /// 新一次启动发起时重置偏移：隧道侧会截断文件，两侧的「从哪读起」必须同时归零。
    func reset() {
        ingestedBytes = 0
    }
}
