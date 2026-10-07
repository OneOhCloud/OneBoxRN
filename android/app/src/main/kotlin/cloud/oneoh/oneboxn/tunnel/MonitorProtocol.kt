package cloud.oneoh.oneboxn.tunnel

import android.os.Bundle
import android.os.Parcel
import android.util.Log
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.Node
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.Traffic

// 引擎观察的跨进程桥协议（:tun MonitorService ↔ UI MonitorBinding）：把 :tun 枢纽汇聚的
// 流量/分组/日志送到 UI 进程，并把 selectNode/urlTest 反向命令送回 :tun。
// 中立契约类型非 Parcelable，故跨进程编解码集中在此单点。
object MonitorProtocol {
    // UI → :tun
    const val MSG_REGISTER = 1 // msg.replyTo = UI 回包 Messenger；注册即回放最近快照
    const val MSG_UNREGISTER = 2
    const val MSG_SELECT = 3 // data: 出站 tag（组 tag 由 :tun 侧按缓存反查）
    const val MSG_URL_TEST = 4 // data: 组 tag

    // :tun → UI
    const val MSG_TRAFFIC = 10
    const val MSG_GROUPS = 11
    const val MSG_LOG_BATCH = 12
    const val MSG_STATUS = 13 // reattach 补发运行状态（广播不重放，注册时经此回放）

    // Binder 事务上限约 1MB；分组快照与日志批次各自设更低预算。超预算即丢弃该次更新并告警，
    // 而非静默抛 TransactionTooLargeException（不掩盖，也不崩隧道）。
    private const val PARCEL_BUDGET_BYTES = 768 * 1024
    internal const val LOG_BATCH_PARCEL_BUDGET_BYTES = 48 * 1024

    // 日志批次 Parcel 的定长部分：长度 4 + magic 4 + 条目数 4 + 两个键各 writeString16（20 与 24）
    // + 两个值类型各 4 + 两个数组元素数各 4 = 72 字节。取 256 留出框架版本漂移的余量。
    private const val LOG_BATCH_PARCEL_OVERHEAD_BYTES = 256L

    private const val KEY_TAG = "tag"
    private const val KEY_UP = "up"
    private const val KEY_DOWN = "down"
    private const val KEY_UP_TOTAL = "upTotal"
    private const val KEY_DOWN_TOTAL = "downTotal"
    private const val KEY_MEMORY = "memory"
    private const val KEY_MEMORY_PEAK = "memoryPeak"
    private const val KEY_CONN_IN = "connIn"
    private const val KEY_CONN_OUT = "connOut"
    private const val KEY_GROUPS = "groups"
    private const val KEY_GROUP_TAG = "gtag"
    private const val KEY_GROUP_NOW = "now"
    private const val KEY_NODE_TAGS = "nodeTags"
    private const val KEY_NODE_DELAYS = "nodeDelays"
    private const val KEY_LOG_LEVELS = "levels"
    private const val KEY_LOG_MESSAGES = "messages"
    private const val KEY_STATUS = "status"

    private const val TAG = "MonitorProtocol"

    fun tagPayload(tag: String): Bundle = Bundle().apply { putString(KEY_TAG, tag) }

    fun tagOf(data: Bundle?): String? = data?.getString(KEY_TAG)

    fun encodeStatus(status: EngineStatus): Bundle = Bundle().apply { putInt(KEY_STATUS, status.ordinal) }

    fun decodeStatus(data: Bundle): EngineStatus {
        val ordinal = data.getInt(KEY_STATUS).coerceIn(0, EngineStatus.entries.lastIndex)
        return EngineStatus.entries[ordinal]
    }

    fun encodeTraffic(traffic: Traffic): Bundle = Bundle().apply {
        putLong(KEY_UP, traffic.up)
        putLong(KEY_DOWN, traffic.down)
        putLong(KEY_UP_TOTAL, traffic.upTotal)
        putLong(KEY_DOWN_TOTAL, traffic.downTotal)
        putLong(KEY_MEMORY, traffic.memory)
        putLong(KEY_MEMORY_PEAK, traffic.memoryPeak)
        putInt(KEY_CONN_IN, traffic.connIn)
        putInt(KEY_CONN_OUT, traffic.connOut)
    }

    fun decodeTraffic(data: Bundle): Traffic = Traffic(
        up = data.getLong(KEY_UP),
        down = data.getLong(KEY_DOWN),
        upTotal = data.getLong(KEY_UP_TOTAL),
        downTotal = data.getLong(KEY_DOWN_TOTAL),
        memory = data.getLong(KEY_MEMORY),
        // 缺键返回 0 = 生产侧不可用，天然向后兼容。
        memoryPeak = data.getLong(KEY_MEMORY_PEAK),
        connIn = data.getInt(KEY_CONN_IN),
        connOut = data.getInt(KEY_CONN_OUT),
    )

    /** 分组快照编码；超 Binder 预算返回 null（调用方跳过该次更新）。 */
    fun encodeGroups(groups: List<NodeGroup>): Bundle? {
        val encoded = ArrayList<Bundle>(groups.size)
        for (group in groups) {
            encoded.add(
                Bundle().apply {
                    putString(KEY_GROUP_TAG, group.tag)
                    putString(KEY_GROUP_NOW, group.now)
                    putStringArray(KEY_NODE_TAGS, group.nodes.map { it.tag }.toTypedArray())
                    putIntArray(KEY_NODE_DELAYS, group.nodes.map { it.delayMs }.toIntArray())
                },
            )
        }
        val bundle = Bundle().apply { putParcelableArrayList(KEY_GROUPS, encoded) }
        val size = parcelSize(bundle)
        if (size > PARCEL_BUDGET_BYTES) {
            Log.w(TAG, "groups snapshot $size B exceeds Binder budget $PARCEL_BUDGET_BYTES B; dropped")
            return null
        }
        return bundle
    }

    fun decodeGroups(data: Bundle): List<NodeGroup> {
        data.classLoader = Bundle::class.java.classLoader
        @Suppress("DEPRECATION")
        val encoded = data.getParcelableArrayList<Bundle>(KEY_GROUPS) ?: return emptyList()
        return encoded.map { group ->
            val tags = group.getStringArray(KEY_NODE_TAGS) ?: emptyArray()
            val delays = group.getIntArray(KEY_NODE_DELAYS) ?: IntArray(0)
            val nodes = tags.mapIndexed { i, tag -> Node(tag, delays.getOrElse(i) { 0 }) }
            NodeGroup(
                tag = group.getString(KEY_GROUP_TAG).orEmpty(),
                nodes = nodes,
                now = group.getString(KEY_GROUP_NOW).orEmpty(),
            )
        }
    }

    /** 日志只走批次协议；超预算返回 null，避免 Binder 事务异常影响隧道数据面。 */
    fun encodeLogBatch(lines: List<LogLine>): Bundle? {
        require(lines.isNotEmpty()) { "log batch must not be empty" }
        require(lines.size <= MonitorLogBatcher.MAX_ENTRIES) { "log batch exceeds entry limit" }
        val size = estimateLogBatchParcelBytes(lines)
        if (size > LOG_BATCH_PARCEL_BUDGET_BYTES) {
            Log.w(TAG, "log batch ~$size B exceeds Binder budget $LOG_BATCH_PARCEL_BUDGET_BYTES B; dropped")
            return null
        }
        return Bundle().apply {
            putIntArray(KEY_LOG_LEVELS, lines.map { it.level.ordinal }.toIntArray())
            putStringArray(KEY_LOG_MESSAGES, lines.map { it.message }.toTypedArray())
        }
    }

    /**
     * 日志批次 Parcel 大小的保守上界：定长部分 + 每行的 UTF-16 本体与定长开销。
     * 日志流下逐批真序列化一遍只为量大小，是持续的原生分配 churn；估算恒 ≥ 实际，
     * 故超预算判定不弱于精确测量。分组快照走低频路径，仍用 `parcelSize` 精确测。
     */
    internal fun estimateLogBatchParcelBytes(lines: List<LogLine>): Long =
        LOG_BATCH_PARCEL_OVERHEAD_BYTES + lines.sumOf { MonitorLogBatcher.contentBytes(it).toLong() }

    fun decodeLogBatch(data: Bundle): List<LogLine> {
        val levels = data.getIntArray(KEY_LOG_LEVELS) ?: IntArray(0)
        val messages = data.getStringArray(KEY_LOG_MESSAGES) ?: emptyArray()
        check(levels.size == messages.size) { "log batch fields have different lengths" }
        check(levels.size <= MonitorLogBatcher.MAX_ENTRIES) { "log batch exceeds entry limit" }
        return messages.mapIndexed { index, message ->
            val ordinal = levels[index].coerceIn(0, LogLevel.entries.lastIndex)
            LogLine(LogLevel.entries[ordinal], message)
        }
    }

    private fun parcelSize(bundle: Bundle): Int {
        val parcel = Parcel.obtain()
        return try {
            parcel.writeBundle(bundle)
            parcel.dataSize()
        } finally {
            parcel.recycle()
        }
    }
}
