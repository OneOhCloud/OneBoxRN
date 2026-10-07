import Foundation

/// 一拍内存样本：采样时刻取自单调时钟（与 `TrafficRateTrend` 同一份时钟契约）。
public struct MemorySample: Sendable, Equatable {
    public let atMillis: Int64
    public let bytes: Int64

    public init(atMillis: Int64, bytes: Int64) {
        self.atMillis = atMillis
        self.bytes = bytes
    }
}

/// 一根内存柱：`offsetMillis` = 样本时刻距横轴起点的毫秒数，恒落 `(0, windowMillis]`。
///
/// 呈现层按 `offsetMillis / windowMillis` 映射到横向位置，柱的**右缘**对齐样本时刻
/// （一根柱表达「截至这一刻的这一拍」，故最新一拍贴右边缘）。
public struct MemoryBar: Sendable, Equatable {
    public let offsetMillis: Int64
    public let bytes: Int64

    public init(offsetMillis: Int64, bytes: Int64) {
        self.offsetMillis = offsetMillis
        self.bytes = bytes
    }
}

/// 内存读数的趋势窗口。
/// 与 Android core/MemoryTrend.kt 逐字对应。
///
/// **按时间收敛，与 `TrafficRateTrend` 同一套语义**：追加时丢弃不晚于「本帧时刻 − `windowMillis`」
/// 的样本。定拍数的纯计数环不带时刻，App 挂起两小时后恢复，那些旧值会被原样画成「最近 60 秒」。
///
/// 时钟契约：`atMillis` 必须来自**单调且计入系统睡眠**的时钟（Android
/// `SystemClock.elapsedRealtime()`、Apple `ContinuousClock`），由平台在收帧处读取。
/// 倒退即契约破坏，直接崩溃暴露。
public struct MemoryTrend: Sendable, Equatable {
    public let samples: [MemorySample]

    public static let empty = MemoryTrend()

    public static let windowMillis: Int64 = 60_000

    /// 柱位数 = 窗口秒数（引擎帧节奏 1 Hz）：**只决定柱宽**，不参与落位。
    public static let barCount = 60

    public init(samples: [MemorySample] = []) {
        self.samples = samples
    }

    /// 窗口内最大值；空窗口为 0。
    public var peak: Int64 { samples.map(\.bytes).max() ?? 0 }

    /// 横轴起点 = 最新样本时刻 − 窗口长度（锚点是最新样本，不另读时钟）；空窗口为 0。
    public var windowStartMillis: Int64 {
        guard let newest = samples.last else { return 0 }
        return newest.atMillis - Self.windowMillis
    }

    /// 呈现投影：窗口内**每个样本一根柱**，按真实时刻定位（与 `TrafficRateTrend` 的 x 映射同一套）。
    ///
    /// **不把时刻量化到秒格**：样本时刻是在 UI 进程收帧处读的，故每帧带着各自不同的投递延迟。
    /// 一旦按「距最新样本几秒」截断落格，投递延迟大于最新一帧的样本就整根右移一格、与右邻样本
    /// 撞进同一格被丢弃，本该有柱的那一秒变成空白——而空白的含义是「那一秒没有数据」。
    /// 于是最新一帧慢则满格、最新一帧快则十几个随机空白列，锚点每秒重取、空白列每秒重洗。
    ///
    /// 缺帧留白改由时刻本身表达：缺了十秒，相邻两根柱的 `offsetMillis` 就差十秒。
    public func bars() -> [MemoryBar] {
        let start = windowStartMillis
        return samples.map { MemoryBar(offsetMillis: $0.atMillis - start, bytes: $0.bytes) }
    }

    /// 追加一拍，并丢弃已滑出时间窗的样本。
    public func appending(atMillis: Int64, bytes: Int64) -> MemoryTrend {
        precondition(bytes >= 0, "memory bytes must be non-negative: \(bytes)")
        if let newest = samples.last {
            precondition(
                atMillis >= newest.atMillis,
                "sample time must not go backwards: \(atMillis) < \(newest.atMillis)")
        }
        let cutoff = atMillis - Self.windowMillis
        let kept = samples.drop(while: { $0.atMillis <= cutoff })
        return MemoryTrend(samples: Array(kept) + [MemorySample(atMillis: atMillis, bytes: bytes)])
    }
}
