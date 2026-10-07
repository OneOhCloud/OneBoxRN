package cloud.oneoh.oneboxn.update

import android.content.Context
import kotlinx.coroutines.flow.StateFlow

// 应用更新的中立契约：界面只认它。应用不下载、不安装任何包——商店分发的应用不得自我更新，
// 有新版本时只把用户带去商店页。

interface AppUpdater {
    val state: StateFlow<UpdateState>

    /** 最近一次检查走到哪一步；有新版本时由 [state] 承担呈现。 */
    val checkStatus: StateFlow<UpdateCheckStatus>

    /** UI 进程冷启动时调用：登记周期检查，并在界面首次进入前台时查一次。 */
    fun scheduleChecks()

    /** 用户点「检查新版本」：不看排期立即查一次；已有检查在途时忽略。 */
    fun checkNow()

    /** 用户点「更新」：打开本应用的商店页；[host] 是当前前台的 Activity。 */
    fun openUpdate(host: Context)
}

enum class UpdateCheckStatus { IDLE, CHECKING, UP_TO_DATE, FAILED }

sealed interface UpdateState {
    data object None : UpdateState

    /** 商店确认有更新：商店页上就有「更新」。商店只报目标构建号 [build]，不报营销版本名。 */
    data class Available(val build: Long) : UpdateState
}
