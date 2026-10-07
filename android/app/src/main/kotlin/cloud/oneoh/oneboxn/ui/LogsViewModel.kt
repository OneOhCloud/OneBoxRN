package cloud.oneoh.oneboxn.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.LogEntry
import cloud.oneoh.oneboxn.LogSource
import cloud.oneoh.oneboxn.LogStore
import cloud.oneoh.oneboxn.core.LogKeywordFilter
import cloud.oneoh.oneboxn.core.LogLevel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.withContext

// 日志页真实状态（镜像 iOS App/UI/LogsViewModel.swift）：注入唯一缓冲 LogStore，
// 按已发布版本拉取当前来源的快照并投影为呈现 state。过滤只作用于呈现、不改动缓冲；
// 清空经缓冲单点，过滤保持当前段（轻触感在视图层）。
@OptIn(ExperimentalCoroutinesApi::class)
class LogsViewModel(
    private val store: LogStore,
    private val projectionDispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    /** 过滤两段：引擎/应用各一段，默认引擎。 */
    enum class SourceFilter(val source: LogSource) {
        ENGINE(LogSource.ENGINE),
        APP(LogSource.APP),
    }

    /** 呈现所需的全部投影：hasEntries 只承载清空入口与整页空态的判空，不留第二份全量列表。 */
    data class UiState(
        val hasEntries: Boolean,
        val filteredEntries: List<LogEntry>,
        val filter: SourceFilter,
        val levelFilter: LogLevel,
        val keyword: String,
    )

    private val selectedSource = MutableStateFlow(SourceFilter.ENGINE)
    private val selectedLevel = MutableStateFlow(LogLevel.INFO)

    /** 关键词原文（进入页面为空 = 不过滤）；判据在 core，只筛呈现。 */
    private val enteredKeyword = MutableStateFlow("")

    private val initialState = project(selectedSource.value, selectedLevel.value, enteredKeyword.value)

    /** 页面无订阅时停止投影（缓冲照常追加，只推进版本）；重返页面时按当前选择重新拉取。 */
    val uiState: StateFlow<UiState> = combine(
        store.publishedVersion,
        selectedSource,
        selectedLevel,
        enteredKeyword,
    ) { _, source, level, keyword ->
        Selection(source, level, keyword)
    }
        .mapLatest { selection ->
            withContext(projectionDispatcher) {
                project(selection.source, selection.level, selection.keyword)
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(), initialState)

    private data class Selection(
        val source: SourceFilter,
        val level: LogLevel,
        val keyword: String,
    )

    fun selectFilter(value: SourceFilter) {
        selectedSource.value = value
    }

    fun selectLevel(value: LogLevel) {
        selectedLevel.value = value
    }

    /** 关键词输入即筛（不防抖——过滤是内存数组的一次 filter）。 */
    fun enterKeyword(value: String) {
        enteredKeyword.value = value
    }

    /** 清空缓冲，过滤保持当前段。 */
    fun clear() {
        store.clear()
    }

    // 只拉取当前所选来源（两段互斥，无「全部」项），按呈现级别与关键词筛出唯一一份展示列表。
    private fun project(source: SourceFilter, level: LogLevel, keyword: String): UiState {
        // 归一一次后复用：逐行再 trim 一遍是把同一份归一做 N 次。
        val needle = LogKeywordFilter.normalize(keyword)
        return UiState(
            hasEntries = store.hasEntries,
            filteredEntries = store.snapshot(source.source)
                .filter { it.level >= level && LogKeywordFilter.matches(it.message, needle) },
            filter = source,
            levelFilter = level,
            keyword = keyword,
        )
    }
}
