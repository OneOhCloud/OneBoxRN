package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.ImportActions
import cloud.oneoh.oneboxn.core.ImportConclusion
import cloud.oneoh.oneboxn.core.ImportError
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.ImportPhase
import cloud.oneoh.oneboxn.core.ImportedProfile
import kotlinx.coroutines.launch

// 导入流程真实状态：AppActions.importProfile 驱动，core 相位一一映射到视图相位
// （深链 apply=1 携 requestedApply=true 走 STOPPING/APPLYING/APPLIED 自动应用路径）。
// IDLE 为初值；同一时刻至多一条流水线（在途闩锁），页面重组不重入；下载与校验失败后可重试；
// 离开页面即随 viewModelScope 取消。
class ImportViewModel(
    private val actions: ImportActions,
    private val payload: ImportPayload,
) : ViewModel() {
    enum class Phase {
        IDLE,
        VERIFYING,
        STOPPING,
        DOWNLOADING,
        APPLYING,
        APPLIED,
        SUCCESS,
        ERROR_NETWORK,
        ERROR_HTTP,
        ERROR_CONTENT,
        ERROR_START,
    }

    var phase by mutableStateOf(Phase.IDLE)
        private set

    /** 存好的那一份与「新增 / 更新」；成功与自动应用两个终态携带。结论页的卡读它，不读配置流。 */
    var imported by mutableStateOf<ImportedProfile?>(null)
        private set

    /** 失败视图滚动区的原始错误信息（错误相位携原始信息呈现）。 */
    var errorDetail by mutableStateOf("")
        private set

    /** 失败视图分类提示的错误来源（文案经 ImportErrorText 唯一映射）；仅错误相位非空。 */
    var error by mutableStateOf<ImportError?>(null)
        private set

    var willApply by mutableStateOf(false)
        private set

    /** 流水线在途：在途时不起第二条；落定后放开，失败页的「重试」才起得来。 */
    private var inFlight = false

    /**
     * 授权等页面前置条件满足后启动。只在还没跑过时起：重组、转屏与重复回调会再调到这里，
     * 已有结局（成功或失败）时照旧不动——重跑失败只走 [retry]，是用户点出来的。
     */
    fun start() {
        // 深链拒绝以空 url 载荷落导入页——不启流水线，停 IDLE 默认态（非错误视图，镜像 iOS）。
        if (payload.url.isEmpty() || phase != Phase.IDLE) return
        launchPipeline()
    }

    /** 失败页的「重试」：只有 core 判给 [ImportConclusion.FailureActions.RETRY_OR_BACK] 的失败有这个出口，别处调到这里是入口漏了。 */
    fun retry() {
        val failed = checkNotNull(error) { "retry without a failure: $phase" }
        check(ImportConclusion.of(failed) == ImportConclusion.Failed(ImportConclusion.FailureActions.RETRY_OR_BACK)) {
            "retry is not offered for $phase"
        }
        launchPipeline()
    }

    private fun launchPipeline() {
        if (inFlight) return
        inFlight = true
        viewModelScope.launch {
            try {
                runPipeline()
            } finally {
                inFlight = false
            }
        }
    }

    private suspend fun runPipeline() {
        actions.importProfile(payload) { corePhase ->
            if (corePhase == ImportPhase.Stopping ||
                corePhase == ImportPhase.Applying ||
                corePhase is ImportPhase.Applied ||
                corePhase is ImportPhase.Downloading && corePhase.willApply
            ) {
                willApply = true
            }
            val view = toViewPhase(corePhase)
            imported = view.imported ?: imported
            errorDetail = view.detail
            error = view.error
            phase = view.phase
        }
    }
}

/** core 相位在视图层的投影（纯数据，随 toViewPhase 单测锁定）。 */
internal data class ImportViewPhase(
    val phase: ImportViewModel.Phase,
    val imported: ImportedProfile? = null,
    val detail: String = "",
    val error: ImportError? = null,
)

// core ImportPhase → 视图相位映射纯函数：四类领域错误各归一个失败视图分支，
// 原始信息（网络诊断/状态码/内容拒因/引擎诊断）经 ImportErrorText 唯一映射进 detail。
internal fun toViewPhase(corePhase: ImportPhase): ImportViewPhase = when (corePhase) {
    ImportPhase.Verifying -> ImportViewPhase(ImportViewModel.Phase.VERIFYING)
    ImportPhase.Stopping -> ImportViewPhase(ImportViewModel.Phase.STOPPING)
    is ImportPhase.Downloading -> ImportViewPhase(ImportViewModel.Phase.DOWNLOADING)
    ImportPhase.Applying -> ImportViewPhase(ImportViewModel.Phase.APPLYING)
    is ImportPhase.Applied -> ImportViewPhase(ImportViewModel.Phase.APPLIED, imported = corePhase.imported)
    is ImportPhase.Success -> ImportViewPhase(ImportViewModel.Phase.SUCCESS, imported = corePhase.imported)
    is ImportPhase.Failed -> {
        val error = corePhase.error
        ImportViewPhase(
            phase = when (error) {
                is ImportError.DownloadNetwork -> ImportViewModel.Phase.ERROR_NETWORK
                is ImportError.DownloadHttp -> ImportViewModel.Phase.ERROR_HTTP
                is ImportError.InvalidContent -> ImportViewModel.Phase.ERROR_CONTENT
                is ImportError.StartFailed -> ImportViewModel.Phase.ERROR_START
            },
            detail = importErrorDetail(error),
            error = error,
        )
    }
}
