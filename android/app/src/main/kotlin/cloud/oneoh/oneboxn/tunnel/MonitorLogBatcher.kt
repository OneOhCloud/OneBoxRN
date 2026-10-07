package cloud.oneoh.oneboxn.tunnel

import cloud.oneoh.oneboxn.core.EngineLogPolicy
import cloud.oneoh.oneboxn.core.LogLine

/**
 * 传输前的有界日志批次；并发保护与 100ms 调度由 MonitorService 负责，本类只保留纯批次策略。
 * 观察客户端全部离场时整泵停摆：不攒批也不留驻，故后台期零编码零驻留；
 * 平台日志设施镜像不经本类，不受停摆影响。
 */
internal class MonitorLogBatcher {
    private val pending = ArrayDeque<LogLine>(CAPACITY)

    // 构造时尚无观察客户端，故初始停摆；MonitorService 在首个客户端注册与集合清空的沿上驱动。
    private var delivering = false

    val hasPending: Boolean
        get() = pending.isNotEmpty()

    /** 观察客户端在场：恢复攒批。 */
    fun resume() {
        delivering = true
    }

    /** 观察客户端全部离场：停摆并丢弃待发送队列（观察数据契约允许丢）。 */
    fun halt() {
        delivering = false
        pending.clear()
    }

    fun offer(line: LogLine) {
        if (!delivering || !EngineLogPolicy.accepts(line.level)) return
        if (pending.size == CAPACITY) pending.removeFirst()
        pending.addLast(boundedLine(line))
    }

    fun drain(): List<LogLine> {
        if (pending.isEmpty()) return emptyList()
        val batch = ArrayList<LogLine>(minOf(MAX_ENTRIES, pending.size))
        var contentBytes = 0
        while (pending.isNotEmpty() && batch.size < MAX_ENTRIES) {
            val next = pending.first()
            val nextBytes = contentBytes(next)
            if (batch.isNotEmpty() && contentBytes + nextBytes > MAX_CONTENT_BYTES) break
            pending.removeFirst()
            batch.add(next)
            contentBytes += nextBytes
        }
        return batch
    }

    private fun boundedLine(line: LogLine): LogLine {
        if (line.message.length <= MAX_MESSAGE_CODE_UNITS) return line
        var end = (MAX_MESSAGE_CODE_UNITS - TRUNCATION_SUFFIX.length).coerceAtLeast(0)
        if (end > 0 && Character.isHighSurrogate(line.message[end - 1])) end--
        return line.copy(message = line.message.take(end) + TRUNCATION_SUFFIX)
    }

    companion object {
        const val CAPACITY = 200
        const val MAX_ENTRIES = 64
        const val MAX_MESSAGE_CODE_UNITS = 1024

        // Bundle/Parcel 的协议上限是 48 KiB；内容预算预留 8 KiB 给键、数组与对齐开销。
        const val MAX_CONTENT_BYTES = 40 * 1024
        const val TRUNCATION_SUFFIX = "... [truncated]"

        // 每行在批次 Parcel 中的定长开销：level 的 4 字节 int 数组槽位 + writeString16 的 4 字节
        // 长度前缀 + 结尾 NUL 的 2 字节 + 最多 2 字节的 4 字节对齐填充。
        private const val ENTRY_OVERHEAD_BYTES = 12
        private const val UTF16_BYTES_PER_CODE_UNIT = 2

        fun contentBytes(line: LogLine): Int =
            (line.message.length.toLong() * UTF16_BYTES_PER_CODE_UNIT + ENTRY_OVERHEAD_BYTES)
                .coerceAtMost(Int.MAX_VALUE.toLong())
                .toInt()
    }
}
