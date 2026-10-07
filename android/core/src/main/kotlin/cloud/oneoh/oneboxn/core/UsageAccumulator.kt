package cloud.oneoh.oneboxn.core

/**
 * 隧道会话内的流量累计器。
 *
 * **逐帧累计、分钟提交**：每一帧都把「本帧累计值 − 上一帧累计值」加进 [pendingUp] / [pendingDown]，
 * 到点才落盘。不能改成「每分钟比较一次累计值」——引擎在分钟中途重启会让计数器归零，
 * 那样只记得到重启后的那一段（100 → 150 → 重置 → 20 会记成 20，真实是 70）。
 *
 * 时刻取自单调时钟（Android `SystemClock.elapsedRealtime()`、Apple `MonotonicClock`），
 * 只用于提交节拍；小时归属另取墙钟，两者不可混用。
 */
data class UsageAccumulator(
    val started: Boolean = false,
    val lastUpTotal: Long = 0,
    val lastDownTotal: Long = 0,
    val pendingUp: Long = 0,
    val pendingDown: Long = 0,
    val lastCommitAtMillis: Long = 0,
) {
    val hasPending: Boolean get() = pendingUp > 0 || pendingDown > 0

    /**
     * 观察一帧累计值。
     *
     * 首帧按「从 0 起算」计入——引擎的累计值本就自本次 start 起从 0 长起来，
     * 把首帧只当基线会白丢开头那一段。计数器回退（`total < 上一帧`）同样按从 0 起算。
     */
    fun observing(atMillis: Long, upTotal: Long, downTotal: Long): UsageAccumulator {
        require(upTotal >= 0 && downTotal >= 0) {
            "traffic totals must be non-negative: up=$upTotal down=$downTotal"
        }
        if (!started) {
            return UsageAccumulator(
                started = true,
                lastUpTotal = upTotal,
                lastDownTotal = downTotal,
                pendingUp = upTotal,
                pendingDown = downTotal,
                lastCommitAtMillis = atMillis,
            )
        }
        return copy(
            lastUpTotal = upTotal,
            lastDownTotal = downTotal,
            pendingUp = pendingUp + delta(upTotal, lastUpTotal),
            pendingDown = pendingDown + delta(downTotal, lastDownTotal),
        )
    }

    /** 是否到了提交节拍；未观察过任何帧时恒 false。 */
    fun shouldCommit(atMillis: Long): Boolean =
        started && atMillis - lastCommitAtMillis >= COMMIT_INTERVAL_MILLIS

    /** 提交后的状态：清空待提交量并把节拍推进到本次提交时刻。 */
    fun committed(atMillis: Long): UsageAccumulator =
        copy(pendingUp = 0, pendingDown = 0, lastCommitAtMillis = atMillis)

    private fun delta(total: Long, previous: Long): Long = if (total >= previous) total - previous else total

    companion object {
        const val COMMIT_INTERVAL_MILLIS = 60_000L
        val EMPTY = UsageAccumulator()
    }
}
