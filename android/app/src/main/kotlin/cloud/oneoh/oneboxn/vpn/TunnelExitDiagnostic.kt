package cloud.oneoh.oneboxn.vpn

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build

/** 系统记下的一次进程退出。字段取自 `ApplicationExitInfo`，形态与平台解耦以便纯逻辑裁判。 */
data class ProcessExitRecord(
    val processName: String,
    val timestampMillis: Long,
    val reason: Int,
    val status: Int,
    val description: String?,
)

/**
 * 失败诊断第 3 级：隧道进程没留下任何诊断就没了时，向系统要退出原因。
 *
 * 存在的理由：`:tun` 崩溃或被 LMK 杀掉时走不到写诊断那步，启动路径只剩一句
 * 「engine stopped before start completed」——这句话把「进程被系统杀了」与
 * 「引擎自己停了」塌成一句，而两者的排查方向完全相反。
 */
object TunnelExitDiagnostic {
    /**
     * 只认属于该进程、且发生在本次启动发起**之后**的记录，取其中最近一条。
     *
     * 时间下界不可省：系统保留的是历史清单，上一次运行的崩溃仍在里面，
     * 不设下界就会把旧崩溃当成本次失败的原因报给用户。
     */
    fun describe(
        records: List<ProcessExitRecord>,
        processName: String,
        sinceMillis: Long,
    ): String? {
        val record = records
            .filter { it.processName == processName && it.timestampMillis >= sinceMillis }
            .maxByOrNull { it.timestampMillis }
            ?: return null
        // 原因码与 status 必须进详情：描述文本随系统版本与厂商变，码才可检索、可跨机器比对。
        val head = "os reported tunnel process exit: reason=${reasonName(record.reason)}(${record.reason})" +
            " status=${record.status}"
        val description = record.description?.takeIf { it.isNotBlank() } ?: return head
        return "$head — $description"
    }

    private fun reasonName(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_ANR -> "ANR"
        ApplicationExitInfo.REASON_CRASH -> "CRASH"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
        ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
        ApplicationExitInfo.REASON_OTHER -> "OTHER"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
        ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
        ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
        else -> "UNKNOWN"
    }
}

/** 向 `ActivityManager` 取历史退出记录的薄适配器；API 30 以下无此能力，返回空清单。 */
class SystemProcessExitReader(private val context: Context) {
    fun records(): List<ProcessExitRecord> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
        val manager = context.getSystemService(ActivityManager::class.java) ?: return emptyList()
        return manager
            .getHistoricalProcessExitReasons(context.packageName, 0, MAX_RECORDS)
            .map {
                ProcessExitRecord(
                    processName = it.processName,
                    timestampMillis = it.timestamp,
                    reason = it.reason,
                    status = it.status,
                    description = it.description,
                )
            }
    }

    private companion object {
        const val MAX_RECORDS = 16
    }
}
