package cloud.oneoh.oneboxn.core

/** 一段时长拆成天、时、分、秒；时恒在 `0…23`。 */
data class DurationParts(val days: Long, val hours: Long, val minutes: Long, val seconds: Long)

// 时长格式化纯函数（首页本次时长用）。只产出结构与纯数字串：
// 「天」这类要随语言变的词不在这里拼，由呈现层按本地化模板组装。
object DurationFormat {
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_DAY = 86_400L
    private const val HOURS_PER_DAY = 24L

    fun parts(seconds: Long): DurationParts {
        require(seconds >= 0) { "duration seconds must be non-negative: $seconds" }
        return DurationParts(
            days = seconds / SECONDS_PER_DAY,
            hours = seconds % SECONDS_PER_DAY / SECONDS_PER_HOUR,
            minutes = seconds % SECONDS_PER_HOUR / SECONDS_PER_MINUTE,
            seconds = seconds % SECONDS_PER_MINUTE,
        )
    }

    /**
     * 钟面 `01:23:45`。小时不封顶：满一天是 `26:03:45` 而不是回到 `02:03:45`，
     * 与不满一天同一形态，才不会被读成分秒。
     */
    fun clock(seconds: Long): String {
        val split = parts(seconds)
        val hours = split.days * HOURS_PER_DAY + split.hours
        return "${twoDigits(hours)}:${twoDigits(split.minutes)}:${twoDigits(split.seconds)}"
    }

    /** 只到分的钟面 `02:03`：满一天之后天数另说，秒位已没有读的意义。 */
    fun hoursMinutes(parts: DurationParts): String = "${twoDigits(parts.hours)}:${twoDigits(parts.minutes)}"

    private fun twoDigits(value: Long): String = value.toString().padStart(2, '0')
}
