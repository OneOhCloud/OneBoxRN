import Foundation

/// 观察通道读数的新鲜度判据。
///
/// 存在的理由：连接状态**不足以**保证读数是新的。观察通道可能在隧道仍连着时失效
/// （端点被夺、读循环致命错、引擎停推），此时 `Traffic` 停在最后一帧而连接门控仍为真，
/// 页面会把几小时前的数字当作实时读数呈现。
///
/// 时钟契约与趋势窗同源：`nowMillis` 与 `lastFrameAtMillis` 必须来自**同一个**单调且
/// 计入系统睡眠的时钟（Apple `ContinuousClock`、Android `SystemClock.elapsedRealtime()`）。
/// 与 Android core/ObservationFreshness.kt 逐字对应。
public enum ObservationFreshness {
    /// 断流阈值：达到即判定断流（压线者出局，与趋势窗的淘汰边界同向）。
    ///
    /// 15 000 ms = 15 帧（引擎帧节奏 1 Hz）。取值理由：通道失效会自动重建、
    /// 通常数秒内恢复，故阈值必须远大于正常抖动；同时又要远小于「用户会误信旧数字」的时长。
    public static let staleAfterMillis: Int64 = 15_000

    /// 距最近一帧的毫秒数；`nil` = 本次会话尚无任何帧到达。
    ///
    /// 开发者页的通道健康度直接读它，故不把减法散到调用方。
    public static func elapsedMillis(lastFrameAtMillis: Int64?, nowMillis: Int64) -> Int64? {
        guard let lastFrameAtMillis else { return nil }
        precondition(
            nowMillis >= lastFrameAtMillis,
            "observation clock must not go backwards: \(nowMillis) < \(lastFrameAtMillis)"
        )
        return nowMillis - lastFrameAtMillis
    }

    /// 读数是否已不可信。
    ///
    /// 「尚无任何帧」同样判为断流：连接刚建立、首帧未到的那一小段，`Traffic` 持有的是
    /// **上一次会话**的最后一帧（停止沿只清两块趋势，不清 `Traffic` 本身），
    /// 若此时判为新鲜就会把上一次连接的数字冒充成本次的。
    public static func isStale(lastFrameAtMillis: Int64?, nowMillis: Int64) -> Bool {
        guard let elapsed = elapsedMillis(lastFrameAtMillis: lastFrameAtMillis, nowMillis: nowMillis) else {
            return true
        }
        return elapsed >= staleAfterMillis
    }
}
