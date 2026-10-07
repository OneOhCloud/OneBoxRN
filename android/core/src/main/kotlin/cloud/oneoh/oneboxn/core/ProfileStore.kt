package cloud.oneoh.oneboxn.core

// 配置文件的纯逻辑存储：模型 + 按 url 幂等 upsert + active 选择 + 序列化，经 ProfileStorage 端口持久化。
// 序列化用最小手写编码（无第三方依赖）：字段以 tab 分隔、记录以换行分隔，内容中的这些字符被转义。
// 内存态只持元信息与激活内容，非激活内容按需回读持久化字节。

data class Profile(
    val id: String,
    val name: String,
    val url: String,
    val usedTraffic: Long,
    val totalTraffic: Long,
    val expireTime: Long,
    /** 首次导入的时刻：重新导入不改它（参考实现同）。 */
    val addedAt: Long,
    /** 导入与每次成功刷新都改写它。 */
    val updatedAt: Long,
    /** 配置服务下发的站点（见 ProfileWebsite）；导入与刷新都按那一次的响应头改写，头缺失即没有站点。 */
    val website: String?,
)

/** 刷新写回的元信息：流量三字段、这次写回的时刻与这次响应带来的站点。 */
data class RefreshedMetadata(val info: TrafficInfo, val updatedAt: Long, val website: String?)

/** 改名的结局：写入了，或名称去首尾空白后为空而没写。 */
enum class RenameOutcome { RENAMED, EMPTY_NAME }

sealed interface RefreshWrite {
    data class Applied(val contentChanged: Boolean) : RefreshWrite

    data object Dropped : RefreshWrite
}

class ProfileStore(private val storage: ProfileStorage) {
    private val profiles = mutableListOf<Profile>()
    private var activeId: String? = null

    /** 常驻内容：稳态只含激活项；写入动作期间临时多含本次写入项，落盘后即回收。 */
    private val residentContents = mutableMapOf<String, String>()

    init {
        val bytes = storage.load()
        if (bytes != null) {
            val text = bytes.decodeToString()
            val snapshot = ProfileCodec.decode(text)
            profiles.addAll(snapshot.profiles)
            activeId = snapshot.activeId
            snapshot.activeId?.let { residentContents[it] = ProfileCodec.content(text, it) }
        }
    }

    fun getAll(): List<Profile> = profiles.toList()

    fun getActive(): Profile? = profiles.firstOrNull { it.id == activeId }

    /** 激活 profile 的配置内容：恒常驻，取值零 IO；无激活时为空。 */
    fun activeContent(): String = activeId?.let { residentContents.getValue(it) }.orEmpty()

    /** 按 id 取配置内容：激活项取常驻值，非激活项按需回读持久化字节；id 不存在即崩。 */
    fun contentOf(id: String): String =
        residentContents[id] ?: ProfileCodec.content(persistedText(), id)

    /**
     * 按 url 幂等 upsert：已存在则更新（保留既有 id 以免 active 悬空，保留既有 addedAt——那是首次导入的时刻），
     * 否则新增。首个 profile 自动置为 active。
     */
    fun upsertByUrl(profile: Profile, content: String): Profile {
        val stored = upsertInMemory(profile, content)
        if (activeId == null) activeId = stored.id
        persist()
        return stored
    }

    /** 导入写入必须把 profile 与激活指针放入同一个持久化快照，避免中间状态和重复 IO。 */
    fun upsertByUrlAndActivate(profile: Profile, content: String): Profile {
        val stored = upsertInMemory(profile, content)
        activeId = stored.id
        persist()
        return stored
    }

    fun setActive(id: String) {
        require(profiles.any { it.id == id }) { "unknown profile id: $id" }
        val content = contentOf(id)
        activeId = id
        residentContents[id] = content
        persist()
    }

    /**
     * 刷新写回（内容已由调用方过 ConfigCheck）：按 url 定位，无匹配 → Dropped 零写入；
     * 命中：流量三字段、updatedAt 与 website 总是更新（已用 = upload + download），内容与旧值不同才标记 contentChanged；
     * 不改 name/id/addedAt、不改激活指针。
     */
    fun applyRefresh(url: String, metadata: RefreshedMetadata, content: String): RefreshWrite {
        val index = profiles.indexOfFirst { it.url == url }
        if (index < 0) return RefreshWrite.Dropped
        val old = profiles[index]
        val contentChanged = content != contentOf(old.id)
        profiles[index] = old.copy(
            usedTraffic = metadata.info.upload + metadata.info.download,
            totalTraffic = metadata.info.total,
            expireTime = metadata.info.expire,
            updatedAt = metadata.updatedAt,
            website = metadata.website,
        )
        residentContents[old.id] = content
        persist()
        return RefreshWrite.Applied(contentChanged)
    }

    /**
     * 改名：去首尾空白后写入；为空不写、返回 EMPTY_NAME；id 不存在即崩。
     * 只动名称：updatedAt、内容与激活指针都不变。重新导入时服务端给了名字就覆盖它，没给则保留（见 ProfileName.derive）。
     */
    fun rename(id: String, name: String): RenameOutcome {
        val index = profiles.indexOfFirst { it.id == id }
        require(index >= 0) { "unknown profile id: $id" }
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return RenameOutcome.EMPTY_NAME
        profiles[index] = profiles[index].copy(name = trimmed)
        persist()
        return RenameOutcome.RENAMED
    }

    /** 删除：require id 存在；删的是激活项则顺延剩余首条，无剩余置空。 */
    fun remove(id: String) {
        val index = profiles.indexOfFirst { it.id == id }
        require(index >= 0) { "unknown profile id: $id" }
        profiles.removeAt(index)
        residentContents.remove(id)
        if (activeId == id) {
            activeId = profiles.firstOrNull()?.id
            activeId?.let { residentContents[it] = contentOf(it) }
        }
        persist()
    }

    private fun upsertInMemory(profile: Profile, content: String): Profile {
        val index = profiles.indexOfFirst { it.url == profile.url }
        val stored = if (index < 0) {
            profiles.add(profile)
            profile
        } else {
            val replacement = profile.copy(id = profiles[index].id, addedAt = profiles[index].addedAt)
            profiles[index] = replacement
            replacement
        }
        residentContents[stored.id] = content
        return stored
    }

    private fun persist() {
        // 非常驻内容原样承袭旧文件字段：不做解码—再编码往返，落盘字节与内容全部常驻时的编码结果一致。
        // 全部内容都常驻时（单 profile 常态）不读旧文件。
        val previous = lazy(LazyThreadSafetyMode.NONE) { persistedText() }
        val text = ProfileCodec.encode(Snapshot(profiles.toList(), activeId)) { id ->
            residentContents[id]?.let(ProfileCodec::escape)
                ?: ProfileCodec.escapedContent(previous.value, id)
        }
        storage.save(text.encodeToByteArray())
        residentContents.keys.retainAll(setOfNotNull(activeId))
    }

    private fun persistedText(): String = storage.load()?.decodeToString().orEmpty()

    companion object {
        /** 存储文件名。 */
        const val FILE_NAME = "profiles.store"
    }
}

internal data class Snapshot(val profiles: List<Profile>, val activeId: String?)

internal object ProfileCodec {
    private const val VERSION = "v1"
    private const val FIELD_COUNT = 10

    /**
     * 升级前写下的记录止于 addedAt：照读，缺的 updatedAt 取 addedAt——那正是它最近一次被导入写下的时刻；
     * 缺的 website 即没有站点。不单独迁移：下一次落盘整份按当前布局重写。
     */
    private const val LEGACY_FIELD_COUNT = 8
    private const val CONTENT_FIELD = 6
    private const val ADDED_AT_FIELD = 7
    private const val UPDATED_AT_FIELD = 8
    private const val WEBSITE_FIELD = 9

    /** 内容字段由调用方按 id 提供转义后形态，编码器不接触未常驻的内容。 */
    fun encode(snapshot: Snapshot, escapedContentOf: (String) -> String): String {
        val sb = StringBuilder()
        sb.append(VERSION).append('\t').append(escape(snapshot.activeId ?: ""))
        for (p in snapshot.profiles) {
            sb.append('\n')
            sb.append(escape(p.id)).append('\t')
                .append(escape(p.name)).append('\t')
                .append(escape(p.url)).append('\t')
                .append(p.usedTraffic).append('\t')
                .append(p.totalTraffic).append('\t')
                .append(p.expireTime).append('\t')
                .append(escapedContentOf(p.id)).append('\t')
                .append(p.addedAt).append('\t')
                .append(p.updatedAt).append('\t')
                .append(escape(p.website.orEmpty()))
        }
        return sb.toString()
    }

    /** 只解元信息：内容字段不切片、不物化，是懒加载的前提。 */
    fun decode(text: String): Snapshot {
        if (text.isEmpty()) return Snapshot(emptyList(), null)
        val header = text.substring(0, lineEnd(text, 0)).split('\t')
        require(header[0] == VERSION) { "unsupported profile store version: ${header[0]}" }
        val activeId = unescape(header.getOrElse(1) { "" }).ifEmpty { null }
        val profiles = ArrayList<Profile>()
        forEachRecord(text) { fields ->
            val addedAt = fields.raw(ADDED_AT_FIELD).toLong()
            val legacy = fields.count == LEGACY_FIELD_COUNT
            profiles.add(
                Profile(
                    id = unescape(fields.raw(0)),
                    name = unescape(fields.raw(1)),
                    url = unescape(fields.raw(2)),
                    usedTraffic = fields.raw(3).toLong(),
                    totalTraffic = fields.raw(4).toLong(),
                    expireTime = fields.raw(5).toLong(),
                    addedAt = addedAt,
                    updatedAt = if (legacy) addedAt else fields.raw(UPDATED_AT_FIELD).toLong(),
                    website = if (legacy) null else unescape(fields.raw(WEBSITE_FIELD)).ifEmpty { null },
                ),
            )
        }
        return Snapshot(profiles, activeId)
    }

    fun content(text: String, id: String): String = unescape(escapedContent(text, id))

    /** 取某条记录的内容字段原文（仍为转义形态）；无该记录即崩（元信息与内容失配）。 */
    fun escapedContent(text: String, id: String): String {
        forEachRecord(text) { fields ->
            if (unescape(fields.raw(0)) == id) return fields.raw(CONTENT_FIELD)
        }
        error("profile content not found: $id")
    }

    fun escape(s: String): String = TextEscape.escape(s)

    private fun unescape(s: String): String = TextEscape.unescape(s)

    private fun lineEnd(text: String, from: Int): Int =
        text.indexOf('\n', from).let { if (it < 0) text.length else it }

    /** 逐记录遍历首行之后的非空行；记录始终以「整份文本 + 区间」示人，调用方要什么字段才切什么片。 */
    private inline fun forEachRecord(text: String, action: (RecordFields) -> Unit) {
        var start = text.indexOf('\n') + 1
        if (start == 0) return
        while (start < text.length) {
            val end = lineEnd(text, start)
            if (end > start) action(RecordFields(text, start, end))
            start = end + 1
        }
    }

    /** 记录的字段切分：只记分隔位置，取值时才切片，避免物化不需要的大字段。 */
    private class RecordFields(private val text: String, private val start: Int, private val end: Int) {
        private val separators = IntArray(FIELD_COUNT - 1)

        /** 本条记录的字段数：当前布局或升级前的布局，其余一律拒绝。 */
        val count: Int

        init {
            var found = 0
            for (i in start until end) {
                if (text[i] != '\t') continue
                require(found < separators.size) {
                    "malformed profile record: expected $FIELD_COUNT fields, got more"
                }
                separators[found] = i
                found++
            }
            count = found + 1
            require(count == FIELD_COUNT || count == LEGACY_FIELD_COUNT) {
                "malformed profile record: expected $FIELD_COUNT fields, got $count"
            }
        }

        fun raw(index: Int): String = text.substring(
            if (index == 0) start else separators[index - 1] + 1,
            if (index == count - 1) end else separators[index],
        )
    }
}
