package cloud.oneoh.oneboxn.core

/** 一拍内存样本：采样时刻取自单调时钟（与 [TrafficRateTrend] 同一份时钟契约）。 */
data class MemorySample(val atMillis: Long, val bytes: Long)

/**
 * 一根内存柱：[offsetMillis] = 样本时刻距横轴起点的毫秒数，恒落 `(0, WINDOW_MILLIS]`。
 *
 * 呈现层按 `offsetMillis / WINDOW_MILLIS` 映射到横向位置，柱的**右缘**对齐样本时刻
 * （一根柱表达「截至这一刻的这一拍」，故最新一拍贴右边缘）。
 */
data class MemoryBar(val offsetMillis: Long, val bytes: Long)

/**
 * 内存读数的趋势窗口。
 *
 * **按时间收敛，与 [TrafficRateTrend] 同一套语义**：追加时丢弃不晚于「本帧时刻 − [WINDOW_MILLIS]」
 * 的样本。不用定 [BAR_COUNT] 拍的纯计数环：那样 App 挂起两小时后恢复，
 * 那 60 拍旧值会被原样画成「最近 60 秒」。
 *
 * 时钟契约：[MemorySample.atMillis] 必须来自**单调且计入系统睡眠**的时钟（Android
 * `SystemClock.elapsedRealtime()`、Apple `ContinuousClock`），由平台在收帧处读取。
 * 倒退即契约破坏，直接崩溃暴露。
 */
data class MemoryTrend(val samples: List<MemorySample> = emptyList()) {

    /** 窗口内最大值；空窗口为 0。 */
    val peak: Long get() = samples.maxOfOrNull { it.bytes } ?: 0L

    /** 横轴起点 = 最新样本时刻 − 窗口长度（锚点是最新样本，不另读时钟）；空窗口为 0。 */
    val windowStartMillis: Long
        get() = samples.lastOrNull()?.let { it.atMillis - WINDOW_MILLIS } ?: 0L

    /**
     * 呈现投影：窗口内**每个样本一根柱**，按真实时刻定位（与 [TrafficRateTrend] 的 x 映射同一套）。
     *
     * **不把时刻量化到秒格**：样本时刻是在 UI 进程收帧处读的，故每帧带着各自不同的投递延迟。
     * 一旦按「距最新样本几秒」截断落格，投递延迟大于最新一帧的样本就整根右移一格、与右邻样本
     * 撞进同一格被丢弃，本该有柱的那一秒变成空白——而空白的含义是「那一秒没有数据」。
     * 于是最新一帧慢则满格、最新一帧快则十几个随机空白列，锚点每秒重取、空白列每秒重洗。
     *
     * 缺帧留白改由时刻本身表达：缺了十秒，相邻两根柱的 [MemoryBar.offsetMillis] 就差十秒。
     */
    fun bars(): List<MemoryBar> {
        val start = windowStartMillis
        return samples.map { MemoryBar(it.atMillis - start, it.bytes) }
    }

    /** 追加一拍，并丢弃已滑出时间窗的样本。 */
    fun appending(atMillis: Long, bytes: Long): MemoryTrend {
        require(bytes >= 0) { "memory bytes must be non-negative: $bytes" }
        val newest = samples.lastOrNull()
        require(newest == null || atMillis >= newest.atMillis) {
            "sample time must not go backwards: $atMillis < ${newest?.atMillis}"
        }
        val cutoff = atMillis - WINDOW_MILLIS
        val kept = samples.dropWhile { it.atMillis <= cutoff }
        return MemoryTrend(kept + MemorySample(atMillis, bytes))
    }

    companion object {
        const val WINDOW_MILLIS = 60_000L

        /** 柱位数 = 窗口秒数（引擎帧节奏 1 Hz）：**只决定柱宽**，不参与落位。 */
        const val BAR_COUNT = 60

        val EMPTY = MemoryTrend()
    }
}
