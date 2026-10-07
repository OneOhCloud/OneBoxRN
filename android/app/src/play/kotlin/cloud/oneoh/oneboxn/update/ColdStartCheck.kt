package cloud.oneoh.oneboxn.update

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first

/**
 * 冷启动那一次检查等界面进入前台再查：系统在后台拉起的进程（周期任务、磁贴）联网可能被限制，
 * 在那里查只会记下一次失败，用户打开应用就看到「检查失败」。
 */
internal suspend fun awaitColdStartCheckTurn(uiForeground: Flow<Boolean>) {
    uiForeground.first { it }
}
