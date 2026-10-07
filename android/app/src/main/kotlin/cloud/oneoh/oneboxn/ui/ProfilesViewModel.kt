package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.ProfileActions
import cloud.oneoh.oneboxn.core.ImportError
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.RefreshOutcome
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 配置页真实状态：注入动作层窄面 ProfileActions，
// 把 profiles/activeProfile 流投影为 snapshot state（视图零改动消费）。激活/删除提升/刷新写回语义
// 全在 core ProfileStore / ConfigRefresh，本层只做入口守卫与结局投影。
class ProfilesViewModel(private val actions: ProfileActions) : ViewModel() {
    /** 整页刷新循环的四态（下拉刷新与列表上方「更新全部」共用）。 */
    enum class RefreshState { IDLE, REFRESHING, SUCCESS, FAILED }

    /** 单行刷新的结局药丸，驻留后自动清除。 */
    enum class RowOutcome { SUCCESS, FAILED }

    /**
     * 一行此刻处于什么状态——三个事实收成一个值：视图问一次就够，行的契约也只剩一个值，
     * 调用点不必拿 `profile.id` 去三个不同的集合里各查一次。
     */
    @Immutable
    data class RowState(
        val isActive: Boolean,
        val isBusy: Boolean,
        val outcome: RowOutcome?,
    )

    /** 取某一行此刻的状态（视图唯一入口）。 */
    fun rowState(profile: Profile): RowState = RowState(
        isActive = profile.id == activeProfile?.id,
        isBusy = profile.id in busyIds,
        outcome = rowOutcomes[profile.id],
    )

    var profiles by mutableStateOf(actions.profiles.value)
        private set
    var activeProfile by mutableStateOf(actions.activeProfile.value)
        private set
    var refreshState by mutableStateOf(RefreshState.IDLE)
        private set

    /** 每行的在飞计数（不是集合）——减到 0 才算不忙。
     *
     * 两条刷新入口共用 [refreshOne]，而它无条件 mark/clear ⇒ 同一份配置会被各标记一次：
     * 整页批次跑到它时，行内那次可能还排在串行数据 lane 上没回来（`refreshProfile` 最终落在
     * `AppDataRepository` 并行度 1 的 lane 上，两次不并发但会一前一后）。
     *
     * 用 Set 的话先回来的那一次会把忙碌位整个清掉，而另一次还没跑——行随即重新可点、菜单里的删除
     * 重新可按，留下一条能在更新途中删掉它的路（忙碌时整行不接受点按、菜单的刷新与删除不可点）。
     */
    private var busyCounts by mutableStateOf<Map<String, Int>>(emptyMap())

    /** 正在更新 / 正在删除的行：整行禁用。 */
    val busyIds: Set<String> get() = busyCounts.keys

    var rowOutcomes by mutableStateOf<Map<String, RowOutcome>>(emptyMap())
        private set

    /** 失败 Alert 携带的领域错误；非空即弹，确认后清空（FAILED 驻留不受影响）。 */
    var refreshError by mutableStateOf<ImportError?>(null)
        private set

    /** 结局态的复位任务：下次触发先取消它，否则上一轮的复位会把新状态覆写回闲置。 */
    private var outcomeRevertJob: Job? = null

    init {
        viewModelScope.launch {
            actions.profiles.collect { profiles = it }
        }
        viewModelScope.launch { actions.activeProfile.collect { activeProfile = it } }
    }

    val hasProfiles: Boolean get() = profiles.isNotEmpty()

    /**
     * 点行即切换为当前配置（setActive + applyConfigurationChange 在 AppActions.activate 单点）。
     * 已是当前项不重走一遍隧道处置；正在刷新的那一行不可切：它的内容正在写回，
     * 此刻切过去拿到的是即将被替换的那一份。
     */
    fun activate(id: String) {
        if (id == activeProfile?.id || id in busyIds) return
        viewModelScope.launch { actions.activate(id) }
    }

    /** 二次确认后的删除（删激活项提升第一条由 ProfileStore.remove 保证）。 */
    fun delete(id: String) {
        viewModelScope.launch {
            markBusy(id)
            try {
                actions.deleteProfile(id)
            } finally {
                clearBusy(id)
            }
        }
    }

    /** 改名：草稿原样交给动作层——去首尾空白与空名拒绝只在 core（`ProfileStore.rename`）判一次。 */
    fun rename(id: String, name: String) {
        viewModelScope.launch { actions.renameProfile(id, name) }
    }

    /** 这一份配置存下来的原文（详情的「复制内容」）。非激活项按需回读，不常驻。 */
    suspend fun content(id: String): String = actions.profileContent(id)

    /**
     * 下拉刷新与列表上方「更新全部」共用本入口与互斥守卫——进行中再触发即忽略
     * （不排队、不报错）。**逐份更新，结局汇总成一条提示**：任意一份失败即整轮 FAILED，
     * 携第一条错误进 Alert；全 Dropped（来源都已删）零反馈回闲置。
     *
     * 刷新集合取触发时刻的快照：刷新期间增删配置不改写本次要刷的那几条。
     */
    fun refreshAll() {
        if (refreshState == RefreshState.REFRESHING) return
        val batch = profiles
        if (batch.isEmpty()) return
        outcomeRevertJob?.cancel()
        refreshState = RefreshState.REFRESHING
        viewModelScope.launch {
            var updated = false
            var firstError: ImportError? = null
            for (profile in batch) {
                when (val outcome = refreshOne(profile)) {
                    is RefreshOutcome.Updated -> updated = true
                    RefreshOutcome.Dropped -> Unit
                    is RefreshOutcome.Failed -> if (firstError == null) firstError = outcome.error
                }
            }
            when {
                firstError != null -> {
                    refreshError = firstError
                    enterOutcome(RefreshState.FAILED)
                }
                updated -> enterOutcome(RefreshState.SUCCESS)
                // 来源已删 → 零写入零 UI 反馈，回到闲置。
                else -> refreshState = RefreshState.IDLE
            }
        }
    }

    /**
     * 行菜单与配置详情的「刷新」：只刷这一份，结局落在这一行的药丸上，不动整页的刷新循环。
     * 失败同样进 Alert：详情开着时这一行的药丸被盖住，只剩提示框说得出为什么失败。
     */
    fun refresh(profile: Profile) {
        if (profile.id in busyIds) return
        viewModelScope.launch {
            when (val outcome = refreshOne(profile)) {
                is RefreshOutcome.Updated -> showRowOutcome(profile.id, RowOutcome.SUCCESS)
                is RefreshOutcome.Failed -> {
                    showRowOutcome(profile.id, RowOutcome.FAILED)
                    refreshError = outcome.error
                }
                RefreshOutcome.Dropped -> Unit
            }
        }
    }

    /** 两条刷新入口共用的那一跳：忙碌位在这里上下，故不可能有一条忘了清。 */
    private suspend fun refreshOne(profile: Profile): RefreshOutcome {
        markBusy(profile.id)
        return try {
            actions.refreshProfile(profile.url)
        } finally {
            clearBusy(profile.id)
        }
    }

    fun dismissRefreshError() {
        refreshError = null
    }

    private fun markBusy(id: String) {
        busyCounts = busyCounts + (id to (busyCounts[id] ?: 0) + 1)
    }

    private fun clearBusy(id: String) {
        val remaining = (busyCounts[id] ?: 0) - 1
        busyCounts = if (remaining > 0) busyCounts + (id to remaining) else busyCounts - id
    }

    private fun showRowOutcome(id: String, outcome: RowOutcome) {
        rowOutcomes = rowOutcomes + (id to outcome)
        viewModelScope.launch {
            delay(ROW_OUTCOME_DWELL_MS)
            // 只清「自己那一次」：驻留期间若又刷了一轮，不越权抹掉新结局。
            if (rowOutcomes[id] == outcome) rowOutcomes = rowOutcomes - id
        }
    }

    /** 结局态驻留后自动回闲置：不回去的话控件永久停在「已更新」，用户再想刷新时看不到刷新图标。 */
    private fun enterOutcome(outcome: RefreshState) {
        refreshState = outcome
        outcomeRevertJob = viewModelScope.launch {
            delay(OUTCOME_DWELL_MS)
            // 只复位「自己那一次」的结局：驻留期间若已被新一轮刷新改写，不越权把新状态拉回闲置。
            if (refreshState == outcome) refreshState = RefreshState.IDLE
        }
    }

    private companion object {
        /** 整页结局态驻留时长，与「已复制」反馈同长。 */
        const val OUTCOME_DWELL_MS = 2_000L

        /** 行内结局药丸的驻留时长：5s 后自动清除。 */
        const val ROW_OUTCOME_DWELL_MS = 5_000L
    }
}
