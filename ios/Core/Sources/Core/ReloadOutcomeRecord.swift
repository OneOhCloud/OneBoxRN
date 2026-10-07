import Foundation

/// 落盘的热重载结局：**独立于命令应答**的那一份。
///
/// 为什么不能只靠应答：失败路径本身就要 `cancelTunnelWithError`，拆完隧道之后那条通道还能不能
/// 回话不由我们决定；隧道进程被系统杀死时更是根本没有应答。两者在 UI 侧塌成同一个「没回话」，
/// 把真因整个擦掉。故结局另落一份，由 UI 侧在应答缺失时对账。
///
/// 带 id 是这份记录成立的前提：没有它就分不清读到的是本次的结局，还是上一次遗留的。
public struct ReloadOutcomeRecord: Sendable, Equatable {
    public let id: UInt64
    /// nil = 成功。与 `ReloadOutcomeCodec` 同一约定，不另立一个成功标志位。
    public let error: EngineError?

    public init(id: UInt64, error: EngineError?) {
        self.id = id
        self.error = error
    }
}

/// 编码 = 重载 id（8 字节大端）+ `ReloadOutcomeCodec` 的既有字节。
///
/// 复用而不是另写一套：应答与落盘承载的是同一件事，两份编码迟早会分叉，而分叉只在失败那一拍现形。
public enum ReloadOutcomeRecordCodec {
    public static func encode(_ record: ReloadOutcomeRecord) -> Data {
        var data = ReloadId.encode(record.id)
        data.append(record.error.map(ReloadOutcomeCodec.encodeFailure) ?? ReloadOutcomeCodec.encodeSuccess())
        return data
    }

    /// 读不出 id 即无从认领，返回 nil——**不**回落成「某次成功」，那会让一次真失败被读成成功。
    public static func decode(_ data: Data) -> ReloadOutcomeRecord? {
        guard let id = ReloadId.decode(data.prefix(ReloadId.byteCount)) else { return nil }
        return ReloadOutcomeRecord(id: id, error: ReloadOutcomeCodec.decode(data.dropFirst(ReloadId.byteCount)))
    }
}
