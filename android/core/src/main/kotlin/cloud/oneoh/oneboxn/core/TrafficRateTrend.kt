package cloud.oneoh.oneboxn.core

/** 一帧网速样本：采样时刻取自单调时钟（[TrafficRateTrend] 的时钟契约）。 */
data class RateSample(val atMillis: Long, val up: Long, val down: Long)

/**
 * 网速读数的趋势窗口。
 *
 * 窗口按**时间**收敛（与 [MemoryTrend] 同一套语义）：追加时丢弃早于「本帧时刻 − [WINDOW_MILLIS]」
 * 的样本，窗口内样本数随帧节奏而定。定拍数的环在 App 挂起两小时后仍持有那 60 个旧拍，
 * 恢复后会被原样画成「过去一分钟」——那是谎报读数，不是可接受的降级。
 *
 * 时钟契约：[atMillis] 必须来自**单调且计入系统睡眠**的时钟（Android `SystemClock.elapsedRealtime()`、
 * Apple `ContinuousClock`），由平台在收帧处读取。倒退即契约破坏，直接崩溃暴露。
 */
data class TrafficRateTrend(val samples: List<RateSample> = emptyList()) {

    /** 窗口内上下行的最大值；空窗口为 0。归一分母的余量系数由呈现层加成，不在此处。 */
    val peak: Long get() = samples.maxOfOrNull { maxOf(it.up, it.down) } ?: 0L

    /** 横轴起点 = 最新样本时刻 − 窗口长度（锚点是最新样本，不另读时钟）；空窗口为 0。 */
    val windowStartMillis: Long
        get() = samples.lastOrNull()?.let { it.atMillis - WINDOW_MILLIS } ?: 0L

    /**
     * 连续段切分（断流留白）：相邻样本间隔超过 [MAX_GAP_MILLIS] 即断开成两段。
     *
     * 呈现层逐段独立成面积——不切段的话，挂起 30 秒后恢复时那条跨越缺口的连线会把
     * 「这半分钟一直在跑」画给用户看，而那半分钟根本没有数据。
     * 窗口本身只淘汰整段过期样本，段内缺口由本方法表达。
     */
    fun segments(): List<List<RateSample>> {
        val result = mutableListOf<List<RateSample>>()
        var current = mutableListOf<RateSample>()
        for (sample in samples) {
            val previous = current.lastOrNull()
            if (previous != null && sample.atMillis - previous.atMillis > MAX_GAP_MILLIS) {
                result.add(current)
                current = mutableListOf()
            }
            current.add(sample)
        }
        if (current.isNotEmpty()) result.add(current)
        return result
    }

    /** 追加一帧，并丢弃已滑出时间窗的样本。 */
    fun appending(atMillis: Long, up: Long, down: Long): TrafficRateTrend {
        require(up >= 0 && down >= 0) { "rate must be non-negative: up=$up down=$down" }
        val newest = samples.lastOrNull()
        require(newest == null || atMillis >= newest.atMillis) {
            "sample time must not go backwards: $atMillis < ${newest?.atMillis}"
        }
        val cutoff = atMillis - WINDOW_MILLIS
        val kept = samples.dropWhile { it.atMillis <= cutoff }
        return TrafficRateTrend(kept + RateSample(atMillis, up, down))
    }

    companion object {
        const val WINDOW_MILLIS = 60_000L

        /** 断流判据：引擎帧节奏 1 Hz，容三帧抖动；超过即视为这中间没有数据。 */
        const val MAX_GAP_MILLIS = 3_000L

        val EMPTY = TrafficRateTrend()
    }
}
