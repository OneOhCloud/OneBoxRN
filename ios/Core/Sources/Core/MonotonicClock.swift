import Foundation

/// 单调时钟（趋势窗的时钟契约）：自进程内固定原点起算的毫秒数，**计入系统睡眠**。
///
/// 为什么必须计入睡眠：`CLOCK_UPTIME_RAW` / `DispatchTime` 这类 uptime 系时钟在设备睡眠期间停走，
/// 挂起两小时后恢复算出的间隔可能只有几秒——依赖它的时间窗会误判「这些旧样本还在窗口内」，
/// 把两小时前的读数画成刚刚发生。Swift 的 `ContinuousClock` 正是 Darwin 上计入睡眠的那一支。
///
/// 只保证**同一进程内**可比：原点是进程首次读取的时刻，跨进程与跨重启无意义，故不可持久化。
/// Android 无对应文件——那边直接用平台的 `SystemClock.elapsedRealtime()`（同语义）。
public enum MonotonicClock {
    private static let origin = ContinuousClock.now

    private static let millisPerSecond: Int64 = 1_000
    private static let attosecondsPerMillisecond: Int64 = 1_000_000_000_000_000

    public static func millis() -> Int64 {
        let elapsed = ContinuousClock.now - origin
        let parts = elapsed.components
        return parts.seconds * millisPerSecond + parts.attoseconds / attosecondsPerMillisecond
    }
}
