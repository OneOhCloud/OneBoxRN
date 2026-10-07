import Foundation

/// 一帧网速样本：采样时刻取自单调时钟（`TrafficRateTrend` 的时钟契约）。
public struct RateSample: Sendable, Equatable {
    public let atMillis: Int64
    public let up: Int64
    public let down: Int64

    public init(atMillis: Int64, up: Int64, down: Int64) {
        self.atMillis = atMillis
        self.up = up
        self.down = down
    }
}

/// 网速读数的趋势窗口。
///
/// 窗口按**时间**收敛（与 `MemoryTrend` 同一套语义）：追加时丢弃早于「本帧时刻 − `windowMillis`」
/// 的样本，窗口内样本数随帧节奏而定。定拍数的环在 App 挂起两小时后仍持有那 60 个旧拍，
/// 恢复后会被原样画成「过去一分钟」——那是谎报读数，不是可接受的降级。
///
/// 时钟契约：`atMillis` 必须来自**单调且计入系统睡眠**的时钟（Apple `ContinuousClock`、
/// Android `SystemClock.elapsedRealtime()`），由平台在收帧处读取。倒退即契约破坏，直接崩溃暴露。
/// 与 Android core/TrafficRateTrend.kt 逐字对应。
public struct TrafficRateTrend: Sendable, Equatable {
    public static let windowMillis: Int64 = 60_000

    /// 断流判据：引擎帧节奏 1 Hz，容三帧抖动；超过即视为这中间没有数据。
    public static let maxGapMillis: Int64 = 3_000

    public static let empty = TrafficRateTrend()

    public let samples: [RateSample]

    public init(samples: [RateSample] = []) {
        self.samples = samples
    }

    /// 窗口内上下行的最大值；空窗口为 0。归一分母的余量系数由呈现层加成，不在此处。
    public var peak: Int64 { samples.map { max($0.up, $0.down) }.max() ?? 0 }

    /// 横轴起点 = 最新样本时刻 − 窗口长度（锚点是最新样本，不另读时钟）；空窗口为 0。
    public var windowStartMillis: Int64 {
        guard let newest = samples.last else { return 0 }
        return newest.atMillis - Self.windowMillis
    }

    /// 连续段切分（断流留白）：相邻样本间隔超过 `maxGapMillis` 即断开成两段。
    ///
    /// 呈现层逐段独立成面积——不切段的话，挂起 30 秒后恢复时那条跨越缺口的连线会把
    /// 「这半分钟一直在跑」画给用户看，而那半分钟根本没有数据。
    /// 窗口本身只淘汰整段过期样本，段内缺口由本方法表达。
    public func segments() -> [[RateSample]] {
        var result: [[RateSample]] = []
        var current: [RateSample] = []
        for sample in samples {
            if let previous = current.last, sample.atMillis - previous.atMillis > Self.maxGapMillis {
                result.append(current)
                current = []
            }
            current.append(sample)
        }
        if !current.isEmpty { result.append(current) }
        return result
    }

    /// 追加一帧，并丢弃已滑出时间窗的样本。
    public func appending(atMillis: Int64, up: Int64, down: Int64) -> TrafficRateTrend {
        precondition(up >= 0 && down >= 0, "rate must be non-negative: up=\(up) down=\(down)")
        if let newest = samples.last {
            precondition(
                atMillis >= newest.atMillis,
                "sample time must not go backwards: \(atMillis) < \(newest.atMillis)"
            )
        }
        let cutoff = atMillis - Self.windowMillis
        let kept = samples.drop { $0.atMillis <= cutoff }
        return TrafficRateTrend(samples: kept + [RateSample(atMillis: atMillis, up: up, down: down)])
    }
}
