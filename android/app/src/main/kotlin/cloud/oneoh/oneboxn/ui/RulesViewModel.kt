package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.RuleActions
import cloud.oneoh.oneboxn.core.Rule
import cloud.oneoh.oneboxn.core.RuleAction
import cloud.oneoh.oneboxn.core.RuleKind
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 路由规则页真实状态（镜像 iOS App/UI/RulesViewModel.swift）：
// 注入动作层窄面 RuleActions，把规则快照流投影为 snapshot state——列表恒为 RuleStore 规范序
// （序/去重/校验语义全在 core）；本层不直持 RuleStore，增删改与 applyConfigurationChange
// 绑定在 RuleActions 单点。
class RulesViewModel(
    private val actions: RuleActions,
    /**
     * 过滤所用的调度器。默认 `Dispatchers.Default`（后台线程）；**测试注入测试调度器**，
     * 否则投影落在真实线程池上、断言只能靠 sleep 撞运气。
     */
    private val projectionDispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    companion object {
        // 搜索阈值单一来源。
        const val SEARCH_THRESHOLD = 12

        /** 搜索防抖时长，与 iOS `RuleProjectionTiming.debounce` 同值。 */
        const val SEARCH_DEBOUNCE_MILLIS = 150L

        // 显式空白集（空格/制表/\n/\r），与 ImportLink、ConfigCheck 同一集合：原生 trim
        // 的 Unicode 空白集两端不一致（如 U+0085，Java 的 isWhitespace 不认、Swift 认）。
        internal fun needsFiltering(rules: List<Rule>, query: String): Boolean =
            rules.size >= SEARCH_THRESHOLD && query.trimAsciiWhitespace().isNotEmpty()

        internal fun filterRules(rules: List<Rule>, query: String): List<Rule> {
            val normalized = query.trimAsciiWhitespace()
            if (!needsFiltering(rules, normalized)) return rules
            return rules.filter { it.value.contains(normalized, ignoreCase = true) }
        }
    }

    var rules: List<Rule> by mutableStateOf(actions.rules.value)
        private set

    var searchText: String by mutableStateOf("")
        private set

    /**
     * 搜索的呈现投影：**防抖 150 ms + 后台线程过滤**，与 iOS `RulesViewModel` 同形。
     *
     * 不做成每次重组同步全量 `filter`：规则可批量粘贴，条数没有上界，逐键在组合线程上
     * 过滤会随规模卡顿。防抖时长与线程处置两端必须一致，否则「同一份规则、同样的键入」
     * 在两端的响应手感不同——那属于可观察差异。
     */
    var filteredRules: List<Rule> by mutableStateOf(actions.rules.value)
        private set

    private var projectionJob: Job? = null

    init {
        viewModelScope.launch {
            actions.rules.collect { list ->
                rules = list
                // 阈值回落即清空搜索词，避免搜索框消失后残留隐形过滤。
                if (list.size < SEARCH_THRESHOLD) searchText = ""
                scheduleProjection()
            }
        }
    }

    fun updateSearch(value: String) {
        if (value == searchText) return
        searchText = value
        scheduleProjection()
    }

    val showsSearch: Boolean get() = rules.size >= SEARCH_THRESHOLD

    private fun scheduleProjection() {
        projectionJob?.cancel()
        val source = rules
        val query = searchText
        if (!needsFiltering(source, query)) {
            filteredRules = source
            return
        }
        projectionJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MILLIS)
            val projection = withContext(projectionDispatcher) { filterRules(source, query) }
            // 「陈旧结果不得发布」在这里**没有显式判断，是结构性满足的**：
            // 上面的 cancel 已让本协程处于取消态，而 `withContext` 返回前会重新检查取消并抛出，
            // 所以下一行到不了。换成回调/Handler 投递结果就会**静默**丢掉这一保证——
            // iOS 那端因此要显式写 `guard !Task.isCancelled`。
            filteredRules = projection
        }
    }

    /** 提交仅含有效 token（校验在编辑器派生）；持久化 → 快照 → 重启在 RuleActions 单点。 */
    fun add(action: RuleAction, kind: RuleKind, values: List<String>) {
        require(values.isNotEmpty()) { "composer must not save empty rule batch" }
        viewModelScope.launch {
            actions.addRules(values.map { Rule(action = action, kind = kind, value = it) })
        }
    }

    /** 编辑提交 = replace（跨 action 迁移与幂等去重在 RuleStore）。 */
    fun replace(old: Rule, action: RuleAction, kind: RuleKind, value: String) {
        viewModelScope.launch {
            actions.replaceRule(old, Rule(action = action, kind = kind, value = value))
        }
    }

    /** 二次确认后的删除。 */
    fun delete(rule: Rule) {
        viewModelScope.launch { actions.removeRule(rule) }
    }
}

// internal 而非 private：两端等价性由测试直接锁这一函数（iOS 侧经 RulesSearchProjection 同判据）。
internal fun String.trimAsciiWhitespace(): String {
    fun isSpace(c: Char) = c == ' ' || c == '\t' || c == '\n' || c == '\r'
    var start = 0
    var end = length
    while (start < end && isSpace(this[start])) start++
    while (end > start && isSpace(this[end - 1])) end--
    return substring(start, end)
}
