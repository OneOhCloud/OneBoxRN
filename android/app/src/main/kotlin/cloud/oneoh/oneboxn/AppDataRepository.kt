package cloud.oneoh.oneboxn

import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.ProfileStorage
import cloud.oneoh.oneboxn.core.ProfileStore
import cloud.oneoh.oneboxn.core.RenameOutcome
import cloud.oneoh.oneboxn.core.Rule
import cloud.oneoh.oneboxn.core.RuleStorage
import cloud.oneoh.oneboxn.core.RuleStore
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * 配置编译只消费这一份不可变数据，避免跨 store 读取到不同时间点的状态。
 *
 * [activeProfileId] 与 [importedConfig] 同一次快照取出：启动路径跨越异步合并，
 * 合并完成后再读一次「当前激活」会把 A 的流量记到 B 头上。
 */
data class StoredConfigSnapshot(
    val importedConfig: String,
    val rules: List<Rule>,
    val activeProfileId: String,
)

/**
 * Profile/Rule 的平台数据边界。
 *
 * Core store 保持同步纯逻辑接口；Android 在此把构造读盘、编码和写盘统一调度到单一 IO lane。
 * 单 lane 同时保护两个可变 store，调用方只观察不可变 StateFlow 快照。
 */
class AppDataRepository(
    private val profileStorage: ProfileStorage,
    private val ruleStorage: RuleStorage,
    storageDispatcher: CoroutineDispatcher = Dispatchers.IO,
    // 首次构造 store 后、首次发布快照前在数据 lane 上跑一次：上一代数据的导入挂在这里，
    // 界面拿到的第一份快照就已经含着导入结果。
    private val onFirstLoad: (ProfileStore, RuleStore) -> Unit = { _, _ -> },
) {
    private data class Stores(
        val profiles: ProfileStore,
        val rules: RuleStore,
    )

    // 并行度 1 不只是为了保护两个可变 store，也是「任意时刻至多一条刷新管线在运行」的唯一保证：
    // 刷新有三个入口且互不相看（下拉 / 列表上方「更新全部」/ 行菜单「刷新」），它们最终都落到
    // 这条 lane 上，一前一后而非并发。把这个 1 调大即破掉该保证。
    private val serialStorageDispatcher = storageDispatcher.limitedParallelism(1)
    private var stores: Stores? = null

    private val _profiles = MutableStateFlow<List<Profile>>(emptyList())
    val profiles: StateFlow<List<Profile>> = _profiles.asStateFlow()

    private val _activeProfile = MutableStateFlow<Profile?>(null)
    val activeProfile: StateFlow<Profile?> = _activeProfile.asStateFlow()

    /** 唯一常驻的配置内容（激活项）；非激活内容不进内存，也就无投影可发。 */
    private val _activeConfigContent = MutableStateFlow("")
    val activeConfigContent: StateFlow<String> = _activeConfigContent.asStateFlow()

    private val _rules = MutableStateFlow<List<Rule>>(emptyList())
    val rules: StateFlow<List<Rule>> = _rules.asStateFlow()

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    /** 幂等预热；首次调用在串行 IO lane 构造 store 并读取已有文件。 */
    suspend fun initialize() {
        onStorageLane { stores() }
    }

    suspend fun awaitLoaded() {
        if (!_loaded.value) initialize()
    }

    /** ImportFlow/ConfigRefresh 复用 Core 单一实现，整个流水线在数据 lane 执行。 */
    suspend fun <T> runProfilePipeline(pipeline: suspend (ProfileStore) -> T): T = onStorageLane {
        try {
            pipeline(stores().profiles)
        } finally {
            publishProfiles()
        }
    }

    suspend fun activateProfile(id: String) = onStorageLane {
        stores().profiles.setActive(id)
        publishProfiles()
    }

    suspend fun deleteProfile(id: String) = onStorageLane {
        stores().profiles.remove(id)
        publishProfiles()
    }

    /** 改名（去空白与空名拒绝归 ProfileStore.rename）：只有写入了才重发快照。 */
    suspend fun renameProfile(id: String, name: String): RenameOutcome = onStorageLane {
        stores().profiles.rename(id, name).also { outcome ->
            if (outcome == RenameOutcome.RENAMED) publishProfiles()
        }
    }

    /** 按 id 取存下来的原文：非激活项由 ProfileStore 按需回读，读完不驻留。 */
    suspend fun profileContent(id: String): String = onStorageLane { stores().profiles.contentOf(id) }

    suspend fun addRules(added: List<Rule>) = onStorageLane {
        stores().rules.add(added)
        publishRules()
    }

    suspend fun replaceRule(old: Rule, new: Rule) = onStorageLane {
        stores().rules.replace(old, new)
        publishRules()
    }

    suspend fun removeRule(rule: Rule) = onStorageLane {
        stores().rules.remove(rule)
        publishRules()
    }

    suspend fun configSnapshot(): StoredConfigSnapshot = onStorageLane {
        val current = stores()
        StoredConfigSnapshot(
            importedConfig = current.profiles.activeContent(),
            rules = current.rules.getAll(),
            activeProfileId = current.profiles.getActive()?.id.orEmpty(),
        )
    }

    /** 孤儿回收的判据：当前仍存在的配置 id 全集。 */
    suspend fun profileIds(): Set<String> = onStorageLane {
        stores().profiles.getAll().map { it.id }.toSet()
    }

    private fun stores(): Stores {
        stores?.let { return it }
        return Stores(
            profiles = ProfileStore(profileStorage),
            rules = RuleStore(ruleStorage),
        ).also { loaded ->
            onFirstLoad(loaded.profiles, loaded.rules)
            stores = loaded
            publishAll(loaded)
            _loaded.value = true
        }
    }

    private fun publishAll(current: Stores) {
        publishProfiles(current.profiles)
        publishRules(current.rules)
    }

    private fun publishProfiles(store: ProfileStore = requireNotNull(stores).profiles) {
        _profiles.value = store.getAll()
        _activeProfile.value = store.getActive()
        _activeConfigContent.value = store.activeContent()
    }

    private fun publishRules(store: RuleStore = requireNotNull(stores).rules) {
        _rules.value = store.getAll()
    }

    private suspend fun <T> onStorageLane(operation: suspend () -> T): T =
        withContext(serialStorageDispatcher) { operation() }
}
