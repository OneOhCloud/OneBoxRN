package cloud.oneoh.oneboxn.core

// 本机用量账本：UTC 小时桶的定容环 + 二进制编解码 + 三档投影。
// 存储恒 UTC；时区只在投影入参（本地日边界）里出现，故本文件不需要任何日历库。

/** 一个小时桶的上下行字节。 */
data class UsageBucket(val up: Long = 0, val down: Long = 0)

/** 当前小时的待落盘累计（sidecar）：与历史环分开落盘，每分钟只重写这一份。 */
data class UsagePending(val hourUtc: Long, val up: Long, val down: Long) {
    fun encode(): ByteArray = UsageCodec.encodePending(this)

    companion object {
        const val BYTES = UsageCodec.PENDING_BYTES

        fun decode(bytes: ByteArray): UsageDecode<UsagePending> = UsageCodec.decodePending(bytes)
    }
}

/**
 * 解码结局：魔数/版本/长度不符即 [Unreadable]。
 *
 * 这里**有意不 fail-fast**：半年账本是辅助面，为它崩掉隧道进程不成比例。
 * 消费方丢弃重建并落一行诊断日志，是本仓 fail-fast 的显式例外。
 */
sealed interface UsageDecode<out T> {
    data class Loaded<T>(val value: T) : UsageDecode<T>

    data object Unreadable : UsageDecode<Nothing>
}

/** 投影档位。 */
enum class UsageTier {
    /** 今日：每格一个 UTC 小时桶。 */
    TODAY,

    /** 近 30 天：每格一个本地日。 */
    MONTH,

    /** 半年：每格一个连续七日块。 */
    HALF_YEAR,
    ;

    /** 该档所需的本地日边界数（末项是「下一日零点」，故恒比格数多一）。 */
    val requiredDayBoundaries: Int
        get() = when (this) {
            TODAY -> 2
            MONTH -> UsageHistory.MONTH_DAYS + 1
            HALF_YEAR -> UsageHistory.HALF_YEAR_BLOCKS * UsageHistory.DAYS_PER_BLOCK + 1
        }
}

/** 投影出的一格：左闭右开的 UTC 小时区间 + 该区间的上下行合计。 */
data class UsageCell(val startHourUtc: Long, val endHourUtc: Long, val up: Long, val down: Long)

/** 一档投影的结果：逐格值 + 区间合计（合计恒等于逐格之和）。 */
data class UsageSeries(val cells: List<UsageCell>, val totalUp: Long, val totalDown: Long)

data class UsageHistory(
    /** 已折进本环的最后一个小时；`.now` sidecar 只有严格更新的小时才被合并（防重复计入）。 */
    val lastHourUtc: Long,
    val buckets: List<UsageBucket>,
) {
    init {
        require(buckets.size == CAPACITY) { "usage history requires $CAPACITY buckets, got ${buckets.size}" }
    }

    /** 取某个 UTC 小时的桶；超出有效窗口（未到 / 已被覆盖）恒为零桶。 */
    fun bucket(hourUtc: Long): UsageBucket {
        if (hourUtc > lastHourUtc || hourUtc <= lastHourUtc - CAPACITY) return UsageBucket()
        return buckets[slotOf(hourUtc)]
    }

    /**
     * 记入一次提交。
     *
     * 跨小时：先把 `(lastHourUtc, hourUtc]` 覆盖的槽清零再累加（最多清一整圈）。
     * 时钟回拨（`hourUtc < lastHourUtc`）：记入 [lastHourUtc] 的桶，不回退也不清零——
     * 用户改一次系统时间不该把历史抹掉。
     */
    fun recording(hourUtc: Long, up: Long, down: Long): UsageHistory {
        require(up >= 0 && down >= 0) { "usage delta must be non-negative: up=$up down=$down" }
        val targetHour = maxOf(hourUtc, lastHourUtc)
        val cleared = if (targetHour > lastHourUtc) clearedSlots(lastHourUtc + 1, targetHour) else buckets
        val slot = slotOf(targetHour)
        val current = cleared[slot]
        val updated = cleared.toMutableList()
        updated[slot] = UsageBucket(up = current.up + up, down = current.down + down)
        return UsageHistory(lastHourUtc = targetHour, buckets = updated)
    }

    /**
     * 合并 sidecar：只有严格新于 [lastHourUtc] 的 pending 才计入。
     *
     * 严格判据是防重复计入的关键——折盘后若进程在写新 sidecar 前被杀，旧 sidecar 仍停在
     * 已折进环的那个小时，宽松判据会让那一小时被读成两倍。
     */
    fun merging(pending: UsagePending): UsageHistory =
        if (pending.hourUtc > lastHourUtc) recording(pending.hourUtc, pending.up, pending.down) else this

    /**
     * 三档投影。
     *
     * [dayBoundaries] 是**本地日边界**的 UTC 小时索引，升序，末项是「下一日零点」；由平台按设备
     * 日历算出（夏令时的 23/25 小时日因此天然成立，core 不需要时区库）。
     */
    fun project(dayBoundaries: List<Long>, tier: UsageTier): UsageSeries {
        require(dayBoundaries.size >= tier.requiredDayBoundaries) {
            "tier ${tier.name} requires ${tier.requiredDayBoundaries} day boundaries, got ${dayBoundaries.size}"
        }
        val cells = when (tier) {
            UsageTier.TODAY -> hourlyCells(dayBoundaries[dayBoundaries.size - 2], dayBoundaries.last())
            UsageTier.MONTH -> blockCells(dayBoundaries, blocks = MONTH_DAYS, daysPerBlock = 1)
            UsageTier.HALF_YEAR -> blockCells(dayBoundaries, HALF_YEAR_BLOCKS, DAYS_PER_BLOCK)
        }
        return UsageSeries(
            cells = cells,
            totalUp = cells.sumOf { it.up },
            totalDown = cells.sumOf { it.down },
        )
    }

    fun encode(): ByteArray = UsageCodec.encodeHistory(this)

    private fun hourlyCells(startHour: Long, endHour: Long): List<UsageCell> =
        (startHour until endHour).map { hour ->
            val bucket = bucket(hour)
            UsageCell(hour, hour + 1, bucket.up, bucket.down)
        }

    /** 从末尾向前取 [blocks] 块、每块 [daysPerBlock] 个日边界，保证今天落在最后一块。 */
    private fun blockCells(dayBoundaries: List<Long>, blocks: Int, daysPerBlock: Int): List<UsageCell> {
        val end = dayBoundaries.size - 1
        return (0 until blocks).map { index ->
            val endIndex = end - (blocks - 1 - index) * daysPerBlock
            val startIndex = endIndex - daysPerBlock
            range(dayBoundaries[startIndex], dayBoundaries[endIndex])
        }
    }

    private fun range(startHour: Long, endHour: Long): UsageCell {
        var up = 0L
        var down = 0L
        for (hour in startHour until endHour) {
            val bucket = bucket(hour)
            up += bucket.up
            down += bucket.down
        }
        return UsageCell(startHour, endHour, up, down)
    }

    private fun clearedSlots(fromHour: Long, toHour: Long): List<UsageBucket> {
        // 空闲久于一整圈时只清一圈：从纪元零点起遍历五十万小时既无意义也慢。
        val start = maxOf(fromHour, toHour - CAPACITY + 1)
        val cleared = buckets.toMutableList()
        for (hour in start..toHour) cleared[slotOf(hour)] = UsageBucket()
        return cleared
    }

    private fun slotOf(hourUtc: Long): Int = (((hourUtc % CAPACITY) + CAPACITY) % CAPACITY).toInt()

    companion object {
        /** 近 30 天档的格数。 */
        const val MONTH_DAYS = 30

        /** 半年档：26 个连续七日块。 */
        const val HALF_YEAR_BLOCKS = 26
        const val DAYS_PER_BLOCK = 7

        /**
         * 182 天 × 24 小时。
         *
         * 取 182 而不是 180：半年档是 26 个连续七日块 = 182 天，环若只有 180 天，
         * 最老那一块永远读不满——展示范围与留存范围必须逐格对齐，否则图上那两格恒为空而无人能解释。
         */
        const val CAPACITY = HALF_YEAR_BLOCKS * DAYS_PER_BLOCK * 24

        /** 定长记录字节数：16 字节头 + CAPACITY × 16。 */
        const val RECORD_BYTES = UsageCodec.HEADER_BYTES + CAPACITY * UsageCodec.BUCKET_BYTES

        /**
         * 记录数上限：与 [RECORD_BYTES] 共同保证目录总量 ≤ 20 MB，由单测断言。
         * 超出时按最旧修改时间淘汰——「每个配置都留半年」因此表述为「最近使用的 192 个」。
         */
        const val MAX_RECORDS = 192

        /** 目录字节上限：断言用的单一来源，不在别处复述数字。 */
        const val DIRECTORY_BYTE_BUDGET = 20L * 1024 * 1024

        /** 文件系统块粒度：定长记录按块占用，容量核算必须按这个量对齐。 */
        const val BLOCK_BYTES = 4096

        /** 记录目录名（两端同一来源，各自 resolve 到平台容器）。 */
        const val DIRECTORY_NAME = "usage"

        /**
         * 记录 id 形态校验：profile id 直接当文件名用，必须挡住路径穿越。
         *
         * 当前生成器产 UUID（`ImportFlow` 的 newId），但解码路径能接受历史上任何字符串——
         * 存储边界不该假定输入永远由当前生成器产出（比照 `TunnelConfigHandoff` 的 token 正则）。
         */
        fun isValidRecordId(profileId: String): Boolean = RECORD_ID.matches(profileId)

        fun historyFileName(profileId: String): String = "${requireRecordId(profileId)}.bin"

        fun pendingFileName(profileId: String): String = "${requireRecordId(profileId)}.now"

        private fun requireRecordId(profileId: String): String {
            require(isValidRecordId(profileId)) { "invalid usage record id" }
            return profileId
        }

        private val RECORD_ID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

        val EMPTY = UsageHistory(lastHourUtc = 0, buckets = List(CAPACITY) { UsageBucket() })

        fun decode(bytes: ByteArray): UsageDecode<UsageHistory> = UsageCodec.decodeHistory(bytes)

        /** 纪元秒 → UTC 小时索引。 */
        fun hourOf(epochSeconds: Long): Long = Math.floorDiv(epochSeconds, 3600L)
    }
}

internal object UsageCodec {
    const val HEADER_BYTES = 16
    const val BUCKET_BYTES = 16
    const val PENDING_BYTES = 32

    private const val VERSION = 1
    private val HISTORY_MAGIC = byteArrayOf('U'.code.toByte(), 'S'.code.toByte(), 'G'.code.toByte(), 'E'.code.toByte())
    private val PENDING_MAGIC = byteArrayOf('U'.code.toByte(), 'S'.code.toByte(), 'G'.code.toByte(), 'N'.code.toByte())

    fun encodeHistory(history: UsageHistory): ByteArray {
        val bytes = ByteArray(UsageHistory.RECORD_BYTES)
        writeHeader(bytes, HISTORY_MAGIC, history.lastHourUtc)
        var offset = HEADER_BYTES
        for (bucket in history.buckets) {
            writeLong(bytes, offset, bucket.up)
            writeLong(bytes, offset + 8, bucket.down)
            offset += BUCKET_BYTES
        }
        return bytes
    }

    fun decodeHistory(bytes: ByteArray): UsageDecode<UsageHistory> {
        if (bytes.size != UsageHistory.RECORD_BYTES || !hasHeader(bytes, HISTORY_MAGIC)) {
            return UsageDecode.Unreadable
        }
        val lastHourUtc = readLong(bytes, 8)
        val buckets = ArrayList<UsageBucket>(UsageHistory.CAPACITY)
        var offset = HEADER_BYTES
        repeat(UsageHistory.CAPACITY) {
            buckets.add(UsageBucket(up = readLong(bytes, offset), down = readLong(bytes, offset + 8)))
            offset += BUCKET_BYTES
        }
        if (buckets.any { it.up < 0 || it.down < 0 }) return UsageDecode.Unreadable
        return UsageDecode.Loaded(UsageHistory(lastHourUtc = lastHourUtc, buckets = buckets))
    }

    fun encodePending(pending: UsagePending): ByteArray {
        val bytes = ByteArray(PENDING_BYTES)
        writeHeader(bytes, PENDING_MAGIC, pending.hourUtc)
        writeLong(bytes, 16, pending.up)
        writeLong(bytes, 24, pending.down)
        return bytes
    }

    fun decodePending(bytes: ByteArray): UsageDecode<UsagePending> {
        if (bytes.size != PENDING_BYTES || !hasHeader(bytes, PENDING_MAGIC)) return UsageDecode.Unreadable
        val up = readLong(bytes, 16)
        val down = readLong(bytes, 24)
        if (up < 0 || down < 0) return UsageDecode.Unreadable
        return UsageDecode.Loaded(UsagePending(hourUtc = readLong(bytes, 8), up = up, down = down))
    }

    private fun writeHeader(bytes: ByteArray, magic: ByteArray, hourUtc: Long) {
        magic.copyInto(bytes, 0)
        bytes[4] = (VERSION and 0xFF).toByte()
        bytes[5] = ((VERSION shr 8) and 0xFF).toByte()
        writeLong(bytes, 8, hourUtc)
    }

    private fun hasHeader(bytes: ByteArray, magic: ByteArray): Boolean {
        for (index in magic.indices) if (bytes[index] != magic[index]) return false
        return bytes[4].toInt() == VERSION && bytes[5].toInt() == 0
    }

    private fun writeLong(bytes: ByteArray, offset: Int, value: Long) {
        for (index in 0 until 8) bytes[offset + index] = ((value shr (index * 8)) and 0xFF).toByte()
    }

    private fun readLong(bytes: ByteArray, offset: Int): Long {
        var value = 0L
        for (index in 0 until 8) value = value or ((bytes[offset + index].toLong() and 0xFF) shl (index * 8))
        return value
    }
}
