package cloud.oneoh.oneboxn.core

/**
 * 一条事件流里连续被跳过的那一段：段开始交出一次，本段每种成因第一次出现各交出一次，段结束交出
 * 一次汇总；其余跳过只计数。
 *
 * 被跳过的事件不能无声消失，但逐个记日志会在引擎启动、重载或设备 Doze 这类持续数秒到数小时的
 * 状态里刷屏，把真正的状态迁移淹掉。已经出现过的成因再切回来也只计数：两种成因交替出现时，
 * 每次切换都交出一次就退化成逐事件一行；切换有多频繁记在汇总的 [Summary.causeChanges] 里。
 * 日志行数因此只随「本段出现了几种成因」增长，与事件数无关；汇总带出每种成因的次数与总数。
 *
 * 不做同步，调用方持锁。
 */
class SkipStreak<C : Any> {

    data class CauseCount<C>(val cause: C, val count: Long)

    /** 一段的账：各成因按第一次出现的先后排列。计数 64 位且溢出即抛，两端同宽，不会悄悄绕回。 */
    data class Summary<C>(
        val counts: List<CauseCount<C>>,
        val total: Long,
        /** 相邻两次跳过成因不同的次数。 */
        val causeChanges: Long,
    )

    sealed interface Transition<out C> {
        /** 一段跳过开始，带这一段的第一个成因。 */
        data class Began<C>(val cause: C) : Transition<C>

        /** 本段第一次出现这个成因。 */
        data class NewCause<C>(val cause: C) : Transition<C>

        /** 这一段结束（事件又送达了，或这条流随会话结束）。 */
        data class Ended<C>(val summary: Summary<C>) : Transition<C>
    }

    private val counts = mutableListOf<CauseCount<C>>()
    private var last: C? = null
    private var total = 0L
    private var causeChanges = 0L

    /** 进行中那一段的账；没有进行中的段时为 null。 */
    val current: Summary<C>?
        get() = last?.let { Summary(counts.toList(), total, causeChanges) }

    /** 记一次跳过。 */
    fun skip(cause: C): Transition<C>? {
        val previous = last
        last = cause
        total = Math.addExact(total, 1L)
        if (previous == null) {
            counts.clear()
            counts.add(CauseCount(cause, 1L))
            return Transition.Began(cause)
        }
        if (previous != cause) causeChanges = Math.addExact(causeChanges, 1L)
        val index = counts.indexOfFirst { it.cause == cause }
        if (index < 0) {
            counts.add(CauseCount(cause, 1L))
            return Transition.NewCause(cause)
        }
        counts[index] = CauseCount(cause, Math.addExact(counts[index].count, 1L))
        return null
    }

    /** 这条流恢复送达，或随会话结束收尾；没有进行中的一段就什么都不交出。 */
    fun end(): Transition<C>? {
        val summary = current ?: return null
        counts.clear()
        last = null
        total = 0L
        causeChanges = 0L
        return Transition.Ended(summary)
    }
}
