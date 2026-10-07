package cloud.oneoh.oneboxn

import cloud.oneoh.oneboxn.core.EngineLogPolicy
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.LogLine
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// 两源日志的唯一内存缓冲（两端同名，对齐 iOS App/LogStore.swift）：
// 按来源各一环、容量各 1000（分源逐出——引擎行高频不逐稀疏应用行）；ENGINE 行入储前
// 剥 ANSI SGR 且低于 info 直接丢弃（常量门槛：上游对 platform 通道全量推送）。
// 全仓不存在第二份日志缓冲组件；除追加与清空外无操作改动缓冲——过滤
// 与跟随只作用于呈现层（LogsViewModel）。追加可能来自任意后台线程（Monitor 回调），
// 故互斥后最多每 100ms 发布一次缓冲版本供 UI 收集；clear 作为用户命令立即发布。
// 发布的是版本号而非列表：呈现只消费单一来源，由呈现层按当前来源拉取一份快照——
// 日志页不在场时引擎洪峰只推进一个计数，不产生任何列表。

/** 日志来源（固定两值，中立命名）：引擎核心 / 应用层（隧道控制与服务事件 + 动作层事件）。 */
enum class LogSource { ENGINE, APP }

/** 单条日志（时间、来源、级别、文本）；id 跨源单调，快照按 id 归并，逐出后列表身份仍稳定。 */
data class LogEntry(
    val id: Long,
    val timeMillis: Long,
    val source: LogSource,
    val level: LogLevel,
    val message: String,
) {
    /** 错误级判定：`error` 及以上。 */
    val isError: Boolean
        get() = level >= LogLevel.ERROR
}

class LogStore internal constructor(
    private val publicationScheduler: LogPublicationScheduler,
) {
    constructor() : this(DefaultLogPublicationScheduler)

    private val buffers = LogSource.entries.associateWith { ArrayDeque<LogEntry>() }
    private var nextId = 0L
    private var contentVersion = 0L
    private var lastPublicationNanos: Long? = null
    private var publicationScheduled = false

    private val _publishedVersion = MutableStateFlow(0L)

    /** 已发布的缓冲版本（节流，≤10 Hz）：每变化一次即一拍新内容可读，内容用 [snapshot] 取。 */
    val publishedVersion: StateFlow<Long> = _publishedVersion.asStateFlow()

    /** 单源快照：该源按追加序的一份拷贝；跨源先后由 [LogEntry.id] 单调表达。 */
    fun snapshot(source: LogSource): List<LogEntry> = synchronized(this) {
        ArrayList(buffers.getValue(source))
    }

    /** 任一来源存有日志（清空入口可用性）：不为判空构造快照。 */
    val hasEntries: Boolean
        get() = synchronized(this) { buffers.values.any { it.isNotEmpty() } }

    fun append(source: LogSource, level: LogLevel, message: String) {
        appendBatch(source, listOf(LogLine(level, message)))
    }

    /** 同一来源的批量入口：整批只更新一次缓冲版本，并由发布节流合并成一个 UI 快照。 */
    fun appendBatch(source: LogSource, lines: List<LogLine>) {
        // 引擎低于 info 不入储（App 侧可见级别的唯一保证——注入的 log.level 不过滤 platform 流）。
        val accepted = lines.asSequence()
            .filter { source != LogSource.ENGINE || EngineLogPolicy.accepts(it.level) }
            .map { line ->
                val message = if (source == LogSource.ENGINE) stripSgr(line.message) else line.message
                LogLine(line.level, message)
            }
            .toList()
        if (accepted.isEmpty()) return

        val timeMillis = System.currentTimeMillis()
        synchronized(this) {
            val buffer = buffers.getValue(source)
            for (line in accepted) {
                buffer.addLast(LogEntry(nextId++, timeMillis, source, line.level, line.message))
                if (buffer.size > CAPACITY) buffer.removeFirst()
            }
            // 环形缓冲不变量破坏 → 立即崩溃，不静默截断。
            check(buffer.size <= CAPACITY) { "log ring buffer exceeded capacity" }
            contentVersion++
            publishOrSchedule()
        }
    }

    /** 清空全部缓冲（过滤保持当前段，呈现层零动作）。 */
    fun clear() {
        synchronized(this) {
            buffers.values.forEach { it.clear() }
            contentVersion++
            publish(publicationScheduler.nowNanos())
        }
    }

    private fun publishOrSchedule() {
        if (contentVersion == _publishedVersion.value) return
        if (publicationScheduled) return
        val now = publicationScheduler.nowNanos()
        val lastPublication = lastPublicationNanos
        val delay = if (lastPublication == null) {
            0L
        } else {
            (PUBLICATION_INTERVAL_NANOS - (now - lastPublication)).coerceAtLeast(0L)
        }
        schedulePublication(delay)
    }

    private fun schedulePublication(delayNanos: Long) {
        publicationScheduled = true
        publicationScheduler.schedule(delayNanos) {
            synchronized(this) {
                publicationScheduled = false
                publishScheduledVersion()
            }
        }
    }

    private fun publishScheduledVersion() {
        if (contentVersion == _publishedVersion.value) return
        val now = publicationScheduler.nowNanos()
        val lastPublication = lastPublicationNanos
        if (lastPublication != null && now - lastPublication < PUBLICATION_INTERVAL_NANOS) {
            schedulePublication(PUBLICATION_INTERVAL_NANOS - (now - lastPublication))
            return
        }
        publish(now)
    }

    private fun publish(nowNanos: Long) {
        _publishedVersion.value = contentVersion
        lastPublicationNanos = nowNanos
    }

    companion object {
        /** 每源环形容量的单一来源。 */
        const val CAPACITY = 1000

        private const val PUBLICATION_INTERVAL_MILLIS = 100L
        private const val NANOS_PER_MILLISECOND = 1_000_000L
        private const val PUBLICATION_INTERVAL_NANOS =
            PUBLICATION_INTERVAL_MILLIS * NANOS_PER_MILLISECOND

        // 剥 ANSI SGR 转义序列（ESC[…m）。着色不引入——语义色只表达状态，剥离而非逐 span 解析着色。
        private const val ESCAPE = '\u001B'
        private val SGR_PATTERN = Regex("\u001B\\[[0-9;]*m")

        // 绝大多数引擎行不含转义序列：先探首个 ESC，无则原样返回，不构造匹配器。
        private fun stripSgr(text: String): String =
            if (text.indexOf(ESCAPE) < 0) text else SGR_PATTERN.replace(text, "")
    }
}

internal interface LogPublicationScheduler {
    fun nowNanos(): Long
    fun schedule(delayNanos: Long, task: () -> Unit)
}

private object DefaultLogPublicationScheduler : LogPublicationScheduler {
    private val executor = ScheduledThreadPoolExecutor(1) { task ->
        Thread(task, "log-publisher").apply { isDaemon = true }
    }.apply {
        removeOnCancelPolicy = true
        executeExistingDelayedTasksAfterShutdownPolicy = false
    }

    override fun nowNanos(): Long = System.nanoTime()

    override fun schedule(delayNanos: Long, task: () -> Unit) {
        executor.schedule(task, delayNanos.coerceAtLeast(0L), TimeUnit.NANOSECONDS)
    }
}
