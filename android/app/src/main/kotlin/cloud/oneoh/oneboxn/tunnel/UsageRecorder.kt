package cloud.oneoh.oneboxn.tunnel

import android.os.SystemClock
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.core.UsageAccumulator
import cloud.oneoh.oneboxn.core.UsageDecode
import cloud.oneoh.oneboxn.core.UsageHistory
import cloud.oneoh.oneboxn.core.UsagePending
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 采样器的两个时钟：提交节拍取单调时钟，小时归属取墙钟。混用会让两条语义互相污染。 */
internal data class UsageClock(
    val elapsedRealtimeMillis: () -> Long = SystemClock::elapsedRealtime,
    val epochSeconds: () -> Long = { System.currentTimeMillis() / 1000 },
)

/** 一个配置的两份记录文件；文件名经 core 的形态校验产出（防路径穿越）。 */
internal data class UsageRecordFiles(val history: File, val pending: File) {
    companion object {
        fun of(directory: File, profileId: String): UsageRecordFiles = UsageRecordFiles(
            history = File(directory, UsageHistory.historyFileName(profileId)),
            pending = File(directory, UsageHistory.pendingFileName(profileId)),
        )
    }
}

/**
 * 隧道进程内的用量采样器。
 *
 * 线程分工：`observe` 在引擎回调线程（任意后台线程）只做锁内的累计器算术；
 * 一切序列化与文件替换投递到单线程 IO 通道——回调线程处在数据面上，绝不能在那里做 IO。
 * IO 失败只落诊断，不回抛（统计是辅助面，其故障不得拖累转发）。
 */
internal class UsageRecorder(
    private val files: UsageRecordFiles,
    private val clock: UsageClock = UsageClock(),
    private val onDiagnostic: (String) -> Unit = {},
) {
    private data class Commit(val hourUtc: Long, val up: Long, val down: Long)

    private companion object {
        const val SHUTDOWN_WAIT_SECONDS = 2L
        const val HISTORY_SUFFIX = ".bin"
        const val PENDING_SUFFIX = ".now"
    }

    private val io = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "usage-recorder") }
    private val lock = Any()

    /** 关闭后到达的帧属于已停止的会话：直接丢弃，不再入队（否则会向已 shutdown 的执行器投递）。 */
    @Volatile private var closed = false

    /** 只在 [lock] 内访问。 */
    private var accumulator = UsageAccumulator.EMPTY

    /** 以下两项只在 IO 线程访问，故无需加锁。 */
    private var history: UsageHistory? = null
    private var pending: UsagePending? = null

    fun observe(traffic: Traffic) {
        if (closed) return
        val now = clock.elapsedRealtimeMillis()
        var commit: Commit? = null
        synchronized(lock) {
            accumulator = accumulator.observing(now, traffic.upTotal, traffic.downTotal)
            if (accumulator.shouldCommit(now)) commit = takeCommit(now)
        }
        commit?.let(::submit)
    }

    /** 停止沿补提交：不等下一分钟，把剩余待提交量落盘。 */
    fun flush() {
        var commit: Commit? = null
        synchronized(lock) {
            if (accumulator.hasPending) commit = takeCommit(clock.elapsedRealtimeMillis())
        }
        commit?.let(::submit)
    }

    /** 停止沿收尾：补提交后**等**队列排空——进程可能紧接着就没了，不等于把最后一次写丢掉。 */
    fun close() {
        flush()
        closed = true
        io.shutdown()
        io.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS)
    }

    /** 调用方已持 [lock]。 */
    private fun takeCommit(now: Long): Commit {
        val commit = Commit(
            hourUtc = UsageHistory.hourOf(clock.epochSeconds()),
            up = accumulator.pendingUp,
            down = accumulator.pendingDown,
        )
        accumulator = accumulator.committed(now)
        return commit
    }

    private fun submit(commit: Commit) {
        // 投递本身也可能被拒（close 与流量回调竞态）：那属于「会话已结束」，丢弃即可——
        // 绝不让 RejectedExecutionException 穿回数据面。
        runCatching {
            io.execute {
                runCatching { apply(commit) }
                    .onFailure { onDiagnostic("usage record failed: ${it.message ?: it.javaClass.simpleName}") }
            }
        }.onFailure { onDiagnostic("usage record dropped: recorder already closed") }
    }

    private fun apply(commit: Commit) {
        val loaded = ensureLoaded(commit.hourUtc)
        val current = pending
        pending = when {
            current == null -> UsagePending(commit.hourUtc, commit.up, commit.down)
            // 同一小时，或墙钟回拨到更早的小时：都记进当前这份，不另起一段。
            commit.hourUtc <= current.hourUtc ->
                current.copy(up = current.up + commit.up, down = current.down + commit.down)
            else -> {
                // 跨小时：先把上一个完整小时折进环并落盘，`.bin` 的 lastHourUtc 因此推进，
                // 旧 sidecar 即便残留也会被读侧的严格判据忽略（防重复计入）。
                //
                // **先写盘、后发布内存态**：反过来的话，写失败会留下「内存已折、盘上未折」的状态，
                // 下一次提交再折一次同一个小时，那一小时就被记了两遍（失败只丢本次提交）。
                val folded = loaded.recording(current.hourUtc, current.up, current.down)
                writeAtomically(files.history, folded.encode())
                history = folded
                UsagePending(commit.hourUtc, commit.up, commit.down)
            }
        }
        writeAtomically(files.pending, pending!!.encode())
    }

    private fun ensureLoaded(hourUtc: Long): UsageHistory {
        history?.let { return it }
        files.history.parentFile?.mkdirs()
        evictOldestBeforeCreating()
        val loaded = readHistory()
        history = loaded
        pending = adoptStoredPending(loaded, hourUtc)
        return history!!
    }

    /**
     * 上一会话遗留的 sidecar 有三种处置：
     * 已折进环（折盘后进程被杀）→ 丢弃，否则那一小时会被记两遍；
     * 属于更早的完整小时 → 折进环；
     * 就是当前小时 → 接着累加，不丢这一段。
     */
    private fun adoptStoredPending(loaded: UsageHistory, hourUtc: Long): UsagePending? {
        val stored = readPending() ?: return null
        if (stored.hourUtc <= loaded.lastHourUtc) return null
        if (stored.hourUtc >= hourUtc) return stored
        history = loaded.recording(stored.hourUtc, stored.up, stored.down)
        writeAtomically(files.history, history!!.encode())
        return null
    }

    /**
     * 创建第 193 份记录前先淘汰最旧的一份。
     *
     * 上限必须在**创建处**执行——只靠 UI 侧回收，两次回收之间就能长出第 193 份，
     * 「目录恒 ≤ 20 MB」那条不变量就成了「多数时候成立」。
     */
    private fun evictOldestBeforeCreating() {
        if (files.history.exists()) return
        val directory = files.history.parentFile ?: return
        val histories = directory.listFiles { file -> file.name.endsWith(HISTORY_SUFFIX) }?.toList().orEmpty()
        if (histories.size < UsageHistory.MAX_RECORDS) return
        histories
            .sortedBy { it.lastModified() }
            .take(histories.size - UsageHistory.MAX_RECORDS + 1)
            .forEach { stale ->
                stale.delete()
                File(directory, stale.name.removeSuffix(HISTORY_SUFFIX) + PENDING_SUFFIX).delete()
                onDiagnostic("usage record evicted: record limit reached")
            }
    }

    private fun readHistory(): UsageHistory {
        if (!files.history.exists()) return UsageHistory.EMPTY
        val decoded = UsageHistory.decode(files.history.readBytes())
        if (decoded is UsageDecode.Loaded) return decoded.value
        // 损坏/版本不识别：丢弃重建，不崩隧道（fail-fast 的显式例外）。
        onDiagnostic("usage history unreadable, rebuilding")
        return UsageHistory.EMPTY
    }

    private fun readPending(): UsagePending? {
        if (!files.pending.exists()) return null
        val decoded = UsagePending.decode(files.pending.readBytes())
        if (decoded is UsageDecode.Loaded) return decoded.value
        onDiagnostic("usage sidecar unreadable, dropping")
        return null
    }

    /** 原子替换：单写者 + rename，读者永不见半份文件。 */
    private fun writeAtomically(target: File, bytes: ByteArray) {
        val temporary = File(target.parentFile, "${target.name}.tmp")
        temporary.writeBytes(bytes)
        if (!temporary.renameTo(target)) {
            temporary.delete()
            error("failed to replace ${target.name}")
        }
    }
}
