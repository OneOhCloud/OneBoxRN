package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.referentialEqualityPolicy
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.ConfigActions
import cloud.oneoh.oneboxn.core.Json
import cloud.oneoh.oneboxn.core.MergeError
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 配置查看页真实状态（镜像 iOS App/UI/ConfigViewModel.swift）：
// 状态提升——进入页面（reload）即异步执行一次合并，全部派生数据（合并输出、格式化投影、
// 逐行视图）在本状态层一次算好并页内缓存，段切换是纯选择、零计算。
// 持有策略：常驻的只有原文引用与合并投影全文，逐行视图是 TextLines（只存行偏移，不复制文本）；
// 离开页面 release 释放全部派生数据，重入以当前输入重算——Activity 级 VM 跨页存活，
// 看过一次配置页不该让多 MB 文本副本陪着进程过完余生。
// Imported = 激活 profile 原文（零改写；无激活 → 整页空态，合并亦无输入）；
// Merged 视图与复制 = mergedConfig() 单一合并出口输出的确定性格式化投影
// （引擎字节仍为紧凑输出；Imported 仍逐字节原文——仅 Merged 采 RN 的 pretty，是有意的差异）。
// MergeError 在本 UI 边界类型化为可重试失败态；模板缺失/结构非法是崩溃类，不捕获。
class ConfigViewModel(
    private val actions: ConfigActions,
    engineVersion: String,
    private val derivationDispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    enum class Source { IMPORTED, MERGED }

    sealed interface MergeState {
        data object Loading : MergeState

        /** 就绪态：text = 格式化投影全文（复制用），lines = 其逐行视图（呈现用，状态提升）。 */
        data class Ready(val text: String) : MergeState {
            val lines: List<String> = TextLines(text)
        }

        /** 失败可重试态，detail 为错误详情。 */
        data class Failed(val detail: String) : MergeState
    }

    var source by mutableStateOf(Source.IMPORTED)
        private set

    /** 激活 profile 的原始导入内容；空串 = 无激活（整页空态）。 */
    var imported by mutableStateOf("")
        private set

    /** 原文逐行视图（状态提升）：视图零派生，段切换/重组不重建；离页由 release 释放。 */
    var importedLines by mutableStateOf<List<String>>(emptyList(), referentialEqualityPolicy())
        private set

    var mergeState by mutableStateOf<MergeState>(MergeState.Loading)
        private set

    /** 就绪态的元信息派生（+N 出站 · DNS），随合并一并计算。 */
    var mergedMeta by mutableStateOf<MergedConfigMeta?>(null)
        private set

    var routingMode by mutableStateOf(actions.routingMode())
        private set

    /** 元信息行左侧引擎版本。 */
    val engineVersionLabel: String = "engine $engineVersion"

    /** 已复制反馈（短暂显示后回落）；写剪贴板在视图层。 */
    var copied by mutableStateOf(false)
        private set

    private var mergeJob: Job? = null
    private var reloadJob: Job? = null
    private var copyRevert: Job? = null

    /** 屏幕进入即刷新并合并（状态提升；Activity 级 VM 跨次存活，重入不得留跨次陈旧值）。 */
    fun reload() {
        reloadJob?.cancel()
        reloadJob = viewModelScope.launch {
            actions.awaitDataReady()
            // 原文与行视图**同拍发布**：两者分别门控页面与正文，分两次发布会出现
            // 「工具栏已可复制、正文却空白」的中间态。行视图只是一趟偏移扫描（不逐行分配），
            // 297 KB / 6800 行约 0.7 ms、3 MB 约 8 ms，不值得为它引入异步窗口。
            val content = actions.activeConfigContent.value
            imported = content
            importedLines = TextLines(content)
            routingMode = actions.routingMode()
            mergedMeta = null
            mergeState = MergeState.Loading
            merge()
        }
    }

    /** 失败态重试重新执行合并（同输入幂等）。 */
    fun retry() = merge()

    /** 视图切换是纯选择，零计算（派生数据已在 reload/merge 提升到状态层）；切视图重置复制反馈。 */
    fun selectSource(value: Source) {
        source = value
        resetCopied()
    }

    /** 当前视图可复制正文（与菜单可用性联动）：导入视图有原文即可复制；合并视图仅就绪态。 */
    val copyableBody: String?
        get() = when (source) {
            Source.IMPORTED -> imported.takeIf { it.isNotEmpty() }
            Source.MERGED -> (mergeState as? MergeState.Ready)?.text
        }

    fun markCopied() {
        copied = true
        copyRevert?.cancel()
        copyRevert = viewModelScope.launch {
            delay(COPY_FEEDBACK_MS)
            copied = false
        }
    }

    /**
     * 离开页面释放派生数据（逐行视图、合并投影与其元信息），在途计算一并取消。
     * 保留 imported——它是激活 profile 内容的同一引用（不是副本），且重入时首帧据此判空态。
     */
    fun release() {
        reloadJob?.cancel()
        mergeJob?.cancel()
        importedLines = emptyList()
        mergeState = MergeState.Loading
        mergedMeta = null
        resetCopied()
    }

    private fun merge() {
        if (imported.isEmpty()) return // 无激活 profile：整页空态，合并段不可达。
        mergeState = MergeState.Loading
        mergeJob?.cancel()
        mergeJob = viewModelScope.launch {
            // 合并含模板资产读取，移出主线程；MergeError 之外的异常原样穿透崩溃。
            val outcome = withContext(derivationDispatcher) {
                try {
                    val merged = actions.mergedConfig()
                    // 格式化投影（视图与复制）。合并输出出自确定性编码，
                    // 重解析抛 JsonError = 内部不变量破坏 → 不捕获，穿透崩溃。
                    val pretty = Json.encodePretty(Json.parse(merged))
                    MergedConfigMeta.parse(merged) to MergeState.Ready(pretty)
                } catch (rejected: MergeError) {
                    null to MergeState.Failed(rejected.message ?: rejected.toString())
                }
            }
            mergedMeta = outcome.first
            mergeState = outcome.second
        }
    }

    private fun resetCopied() {
        copyRevert?.cancel()
        copied = false
    }
}
