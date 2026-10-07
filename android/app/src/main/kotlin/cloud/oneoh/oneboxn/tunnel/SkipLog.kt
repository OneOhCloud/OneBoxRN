package cloud.oneoh.oneboxn.tunnel

import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.SkipStreak

/** 一种跳过的成因：日志里的名字与级别。 */
interface SkipCause {
    val token: String
    val level: LogLevel
}

/**
 * 一条事件流的跳过记账：core [SkipStreak] 每交出一次迁移写一行，其余跳过只计数。
 *
 * 写日志留在锁内：两个线程各自拿到一次迁移、却在锁外交错写出，读日志的人会看到「结束」排在
 * 「开始」前面。
 */
class SkipLog<C : SkipCause>(
    private val stream: String,
    private val write: (LogLine) -> Unit,
) {
    private val lock = Any()
    private val streak = SkipStreak<C>()

    /** [detail] 只在这一段开始或新成因出现的那一行里出现。 */
    fun skip(cause: C, detail: String = "") {
        val suffix = if (detail.isEmpty()) "" else " ($detail)"
        synchronized(lock) {
            when (val transition = streak.skip(cause)) {
                null, is SkipStreak.Transition.Ended -> Unit
                is SkipStreak.Transition.Began ->
                    write(LogLine(transition.cause.level, "$stream events skipped: ${transition.cause.token}$suffix"))
                is SkipStreak.Transition.NewCause ->
                    write(LogLine(transition.cause.level, "$stream events also skipped: ${transition.cause.token}$suffix"))
            }
        }
    }

    /** 这条流的事件又放行了（交到了下一站）。 */
    fun delivered() = end { "$stream events pass again after $it" }

    /** 会话结束：还没结束的那一段带着计数收尾，跳过的次数一条不少。 */
    fun close() = end { "$stream skips closed with the session after $it" }

    private fun end(message: (String) -> String) {
        synchronized(lock) {
            val summary = (streak.end() as? SkipStreak.Transition.Ended)?.summary ?: return
            val perCause = summary.counts.joinToString(" ") { "${it.cause.token}=${it.count}" }
            // 取本段最重的级别：warn 成因的次数不能跟着一条 debug 汇总一起被滤掉。
            val level = summary.counts.maxOfOrNull { it.cause.level } ?: LogLevel.DEBUG
            write(LogLine(level, message("${summary.total} skipped ($perCause; cause changes ${summary.causeChanges})")))
        }
    }
}
