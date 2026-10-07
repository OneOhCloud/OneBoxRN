package cloud.oneoh.oneboxn.core

// 何时检查更新：冷启动必查，成功后隔一个周期再查，失败按指数退避重试且不超过一个周期。
// 与 iOS Core/UpdateCheckSchedule.swift 同名同义，
// golden/update-check-schedule.json 是行为裁判。时间均为 Unix 毫秒。

data class UpdateCheckInput(
    val nowMillis: Long,
    /** null = 从未成功过。 */
    val lastSuccessMillis: Long?,
    /** null = 从未尝试过。 */
    val lastAttemptMillis: Long?,
    /** 自上次成功以来连续失败的次数。 */
    val consecutiveFailures: Int,
    val coldStart: Boolean,
)

/** [due] 为 true 时 [nextCheckAtMillis] 等于当前时间。 */
data class UpdateCheckPlan(val due: Boolean, val nextCheckAtMillis: Long)

object UpdateCheckSchedule {
    const val PERIOD_MILLIS = 6L * 60 * 60 * 1000
    const val BACKOFF_BASE_MILLIS = 5L * 60 * 1000

    fun plan(input: UpdateCheckInput): UpdateCheckPlan {
        require(input.consecutiveFailures >= 0) { "negative failure count: ${input.consecutiveFailures}" }
        require(input.consecutiveFailures == 0 || input.lastAttemptMillis != null) { "failures without an attempt time" }
        val now = input.nowMillis
        if (input.coldStart) return UpdateCheckPlan(true, now)
        // 晚于当前时间的记录说明时钟回拨过；按它等下去可能要等上回拨的那一整段，故视作没有这条记录。
        val successDue = input.lastSuccessMillis?.takeIf { it <= now }?.let { it + PERIOD_MILLIS }
        val backoffDue = input.lastAttemptMillis?.takeIf { it <= now && input.consecutiveFailures > 0 }
            ?.let { it + backoff(input.consecutiveFailures) }
        val dueAt = listOfNotNull(successDue, backoffDue).maxOrNull() ?: return UpdateCheckPlan(true, now)
        return if (now >= dueAt) UpdateCheckPlan(true, now) else UpdateCheckPlan(false, dueAt)
    }

    /** min(周期, 基数 × 2^(失败次数-1))；先封顶指数，免得移位溢出。 */
    private fun backoff(failures: Int): Long {
        var delay = BACKOFF_BASE_MILLIS
        repeat(failures - 1) {
            delay *= 2
            if (delay >= PERIOD_MILLIS) return PERIOD_MILLIS
        }
        return delay
    }
}

/**
 * 手动检查的最短可见时长：检查早于它结束也等满再揭晓结果，否则「检查中」一闪而过，
 * 用户读不出「刚才确实查过了」。golden/update-check-pacing.json 是行为裁判。
 */
object UpdateCheckPacing {
    const val MINIMUM_VISIBLE_MILLIS: Long = 1000

    /** 揭晓结果前还要再等的毫秒数。[elapsedMillis] 取单调时钟，为负即调用方用错了时钟。 */
    fun revealDelayMillis(elapsedMillis: Long): Long {
        require(elapsedMillis >= 0) { "negative elapsed time: $elapsedMillis" }
        return maxOf(0, MINIMUM_VISIBLE_MILLIS - elapsedMillis)
    }
}
