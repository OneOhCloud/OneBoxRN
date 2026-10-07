package cloud.oneoh.oneboxn.core

// 配置更新执行记录的单一时间线：后台与手动共用一条线，
// 追加时按「条数上限 + 保留天数」两条同时逐出。时刻由调用方注入，本类型不读时钟。
// 与 iOS Core/RefreshRecordStore.swift 逐字对应，golden/refresh-record-store.json 是行为裁判。

/** 这次执行由谁发起。 */
enum class RefreshTrigger { AUTO, MANUAL }

/** 这次执行的结局，与 ConfigRefresh 的写回结局一一对应。 */
enum class RefreshRecordOutcome { UPDATED, DROPPED, FAILED }

/**
 * 一次抓取的记录。
 *
 * **绝不含加速地址的任何形态**（明文、脱敏或哈希预映像）——走没走加速只由 [route] 表达。
 */
data class RefreshRecord(
    val occurredAtMillis: Long,
    val profileId: String,
    val profileName: String,
    val trigger: RefreshTrigger,
    val outcome: RefreshRecordOutcome,
    val contentChanged: Boolean,
    val durationMillis: Long,
    val route: FetchRoute,
    /** 未回落时的拒绝理由；走了加速或未触发判定则为 null。 */
    val denial: FallbackDenial?,
    /** 失败 token（ImportError 的 token）；成功为 ""。 */
    val errorToken: String,
    val usedTraffic: Long,
    val totalTraffic: Long,
    val expireTime: Long,
)

class RefreshRecordStore(private val storage: RefreshRecordStorage) {
    // 内存持有的是「旧在前」的追加序，与落盘序一致；对外一律新在前。
    private val records: MutableList<RefreshRecord> =
        storage.load()?.let { RefreshRecordCodec.decode(it.decodeToString()) }.orEmpty().toMutableList()

    /** 时间线，最新在前（倒序呈现）。 */
    fun all(): List<RefreshRecord> = records.asReversed().toList()

    /** 追加一条并落盘；以新记录的时刻为基准逐出过期与超额条目。 */
    fun append(record: RefreshRecord) {
        records.add(record)
        evict(nowMillis = record.occurredAtMillis)
        persist()
    }

    fun clear() {
        records.clear()
        persist()
    }

    private fun evict(nowMillis: Long) {
        val cutoff = nowMillis - MAX_AGE_MILLIS
        records.retainAll { it.occurredAtMillis >= cutoff }
        while (records.size > MAX_RECORDS) records.removeAt(0)
    }

    private fun persist() {
        storage.save(RefreshRecordCodec.encode(records.toList()).encodeToByteArray())
    }

    companion object {
        /** 存储文件名。 */
        const val FILE_NAME = "refresh-records.store"

        const val MAX_RECORDS = 200
        const val MAX_AGE_MILLIS = 30L * 24 * 60 * 60 * 1000
    }
}

internal object RefreshRecordCodec {
    private const val VERSION = "v1"
    private const val FIELD_COUNT = 13

    /** 首行版本，其后每行一条记录（旧在前）。 */
    fun encode(records: List<RefreshRecord>): String {
        val sb = StringBuilder()
        sb.append(VERSION)
        for (r in records) {
            sb.append('\n')
                .append(r.occurredAtMillis).append('\t')
                .append(TextEscape.escape(r.profileId)).append('\t')
                .append(TextEscape.escape(r.profileName)).append('\t')
                .append(r.trigger.name).append('\t')
                .append(r.outcome.name).append('\t')
                .append(if (r.contentChanged) "1" else "0").append('\t')
                .append(r.durationMillis).append('\t')
                .append(r.route.name).append('\t')
                .append(r.denial?.name ?: "").append('\t')
                .append(TextEscape.escape(r.errorToken)).append('\t')
                .append(r.usedTraffic).append('\t')
                .append(r.totalTraffic).append('\t')
                .append(r.expireTime)
        }
        sb.append('\n')
        return sb.toString()
    }

    /** 解析期 fail-loud：版本不识、字段数不符、token 未知一律抛，不静默丢记录。 */
    fun decode(text: String): List<RefreshRecord> {
        val lines = text.split('\n')
        if (lines.isEmpty() || lines[0].isEmpty()) return emptyList()
        require(lines[0] == VERSION) { "unsupported refresh record store version: ${lines[0]}" }
        return lines.drop(1).filter { it.isNotEmpty() }.map(::decodeRecord)
    }

    private fun decodeRecord(line: String): RefreshRecord {
        val f = line.split('\t')
        require(f.size == FIELD_COUNT) { "refresh record needs $FIELD_COUNT fields, got ${f.size}" }
        return RefreshRecord(
            occurredAtMillis = f[0].toLong(),
            profileId = TextEscape.unescape(f[1]),
            profileName = TextEscape.unescape(f[2]),
            trigger = RefreshTrigger.valueOf(f[3]),
            outcome = RefreshRecordOutcome.valueOf(f[4]),
            contentChanged = f[5] == "1",
            durationMillis = f[6].toLong(),
            route = FetchRoute.valueOf(f[7]),
            denial = f[8].ifEmpty { null }?.let(FallbackDenial::valueOf),
            errorToken = TextEscape.unescape(f[9]),
            usedTraffic = f[10].toLong(),
            totalTraffic = f[11].toLong(),
            expireTime = f[12].toLong(),
        )
    }
}
