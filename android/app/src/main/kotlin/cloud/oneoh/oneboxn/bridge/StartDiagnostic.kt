package cloud.oneoh.oneboxn.bridge

import android.content.Context
import android.util.Log
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.describe
import java.io.FileNotFoundException
import java.io.IOException

/**
 * 启动诊断的跨进程通道（`:tun` 写、UI 读）——失败诊断取数阶梯第 1 级的唯一读写口
 * （写者是 `TunnelService`）。镜像 iOS `App/VPN/StartDiagnostic.swift`。
 *
 * Android **没有** iOS 那样的启动阶段标记（阶梯第 2 级）：隧道进程被系统杀在写错误之前时，
 * 这条通道给不出任何东西，得由收口处的系统退出原因（第 3 级，`TunnelExitDiagnostic`）接住。
 * 正因为只此一条，任一端静默即整级消失，故三个入口的失败一律落 `Log.e`——观察面故障不升级
 * 为数据面故障，但也不许不留证据。
 */
object StartDiagnostic {
    /** UI 侧读取隧道进程写下的真因；null = 本次没有失败（文件不存在或已被本次启动清空）。 */
    fun read(context: Context): EngineError? {
        val file = EnginePaths.startError(context)
        val detail = try {
            file.readText().trim()
        } catch (missing: FileNotFoundException) {
            return null
        } catch (failed: IOException) {
            // 「读不出来」不等于「没有错误」：折成空串会让一次真实的启动失败在 UI 上表现成
            // 什么都没发生，而这条通道正是 UI 唯一能问到引擎真因的地方。
            Log.e(TAG, "start diagnostic read failed", failed)
            return EngineError(START_FAILED_GENERIC, "start diagnostic unreadable: ${describe(failed)}")
        }
        return if (detail.isEmpty()) null else EngineError(START_FAILED_GENERIC, detail)
    }

    /** 隧道进程登记本次失败的真因；写不进去即 UI 侧整级失明，故必须留痕。 */
    fun write(context: Context, detail: String) {
        try {
            EnginePaths.startError(context).writeText(detail)
        } catch (failed: IOException) {
            Log.e(TAG, "start diagnostic write failed", failed)
        }
    }

    /** 启动入口清上一次的残留；清不掉的话残留会冒充本次结局（第 1 级读到旧错误）。 */
    fun clear(context: Context) {
        try {
            EnginePaths.startError(context).writeText("")
        } catch (failed: IOException) {
            Log.e(TAG, "start diagnostic clear failed", failed)
        }
    }

    private const val TAG = "StartDiagnostic"
    private const val START_FAILED_GENERIC = "START_FAILED_GENERIC"
}
