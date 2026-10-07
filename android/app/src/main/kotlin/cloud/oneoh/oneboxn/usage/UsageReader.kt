package cloud.oneoh.oneboxn.usage

import android.content.Context
import cloud.oneoh.oneboxn.core.UsageDecode
import cloud.oneoh.oneboxn.core.UsageHistory
import cloud.oneoh.oneboxn.core.UsagePending
import cloud.oneoh.oneboxn.core.UsageSeries
import cloud.oneoh.oneboxn.core.UsageTier
import java.io.File
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/** 一次读取的结果：账本 + 该配置是否已有记录（无记录 → 空态，而不是一排 0 值柱）。 */
data class UsageRecordSnapshot(val history: UsageHistory, val hasRecord: Boolean)

/**
 * 用量账本的 UI 侧读者。
 *
 * 只读 + 回收：写者恒是隧道进程，本类唯一的写动作是删除孤儿记录，
 * 且只在隧道未运行时由动作层调用（避免与运行中的采样器争同一份文件）。
 *
 * 记录目录落 `noBackupFilesDir`：本机口径的数据跟着云备份迁到另一台设备就不再是本设备的数。
 */
class UsageReader(private val directory: File) {

    constructor(context: Context) : this(File(context.noBackupFilesDir, UsageHistory.DIRECTORY_NAME))

    /**
     * 读一个配置的账本：历史环 + 当前小时 sidecar，一次调用同时给出「有没有记录」。
     *
     * **先读 sidecar 再读历史环**：反过来的话，恰逢写者折盘的那一瞬（先写 .bin 再写新 .now），
     * 会读到「折盘前的环 + 折盘后的新 sidecar」，上一小时凭空消失；本序下最坏是读到
     * 「已折进环的旧 sidecar」，而 merging 的严格判据本就会忽略它。
     *
     * 存在性与内容同一次读出：分两次 IO 会在第一个小时里读到「.bin 还没有、.now 已经有」，
     * 页面据此进空态，而数据其实已经在了。
     */
    fun load(profileId: String): UsageRecordSnapshot {
        if (!UsageHistory.isValidRecordId(profileId)) return UsageRecordSnapshot(UsageHistory.EMPTY, false)
        val pending = decodePending(File(directory, UsageHistory.pendingFileName(profileId)))
        val historyFile = File(directory, UsageHistory.historyFileName(profileId))
        val hasHistory = historyFile.exists()
        val history = decodeHistory(historyFile)
        return UsageRecordSnapshot(
            history = if (pending == null) history else history.merging(pending),
            hasRecord = hasHistory || pending != null,
        )
    }

    /**
     * 孤儿回收：删掉已不在配置集合里的记录，并把总数压到上限内。
     * 只在隧道未运行时调用——运行中的采样器是那些文件的唯一写者。
     */
    fun reclaim(liveProfileIds: Set<String>) {
        val records = directory.listFiles()?.toList() ?: return
        for (file in records) {
            if (recordIdOf(file.name)?.let { it !in liveProfileIds } == true) file.delete()
        }
        evictOldestBeyondLimit()
    }

    private fun evictOldestBeyondLimit() {
        val histories = directory.listFiles { file -> file.name.endsWith(HISTORY_SUFFIX) }?.toList() ?: return
        if (histories.size <= UsageHistory.MAX_RECORDS) return
        histories
            .sortedBy { it.lastModified() }
            .take(histories.size - UsageHistory.MAX_RECORDS)
            .forEach { file ->
                file.delete()
                recordIdOf(file.name)?.let { File(directory, UsageHistory.pendingFileName(it)).delete() }
            }
    }

    private fun recordIdOf(fileName: String): String? {
        val id = fileName.substringBeforeLast('.')
        return if (UsageHistory.isValidRecordId(id)) id else null
    }

    private fun decodeHistory(file: File): UsageHistory {
        if (!file.exists()) return UsageHistory.EMPTY
        val decoded = UsageHistory.decode(file.readBytes())
        return if (decoded is UsageDecode.Loaded) decoded.value else UsageHistory.EMPTY
    }

    private fun decodePending(file: File): UsagePending? {
        if (!file.exists()) return null
        val decoded = UsagePending.decode(file.readBytes())
        return if (decoded is UsageDecode.Loaded) decoded.value else null
    }

    private companion object {
        const val HISTORY_SUFFIX = ".bin"
    }
}

/**
 * 账本 → 某一档的投影：日历边界算在平台侧、求和在 core。
 * 用量页与配置页今日图共用本入口，避免「档位 → 需要几个日边界」这层换算出现第二份。
 */
fun projectUsage(history: UsageHistory, tier: UsageTier, nowMillis: Long): UsageSeries =
    history.project(
        // 末项是「明天零点」，故天数比边界数少一。
        dayBoundaries = localDayBoundaries(tier.requiredDayBoundaries - 1, nowMillis),
        tier = tier,
    )

/**
 * 本地日边界：投影所需的 UTC 小时索引序列，末项是「明天零点」。
 *
 * 日历算在平台侧、求和算在 core：夏令时的 23/25 小时日因此天然成立，core 不必带时区库。
 */
fun localDayBoundaries(days: Int, nowMillis: Long, timeZone: TimeZone = TimeZone.getDefault()): List<Long> {
    require(days >= 1) { "usage projection needs at least one day" }
    val calendar = Calendar.getInstance(timeZone, Locale.US)
    calendar.timeInMillis = nowMillis
    calendar.set(Calendar.HOUR_OF_DAY, 0)
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    // 末项必须是「明天零点」（今天这一格的右开端），故起点回退 days - 1 天。
    calendar.add(Calendar.DAY_OF_YEAR, -(days - 1))

    val boundaries = ArrayList<Long>(days + 1)
    repeat(days + 1) {
        boundaries.add(UsageHistory.hourOf(calendar.timeInMillis / 1000))
        calendar.add(Calendar.DAY_OF_YEAR, 1)
    }
    return boundaries
}
