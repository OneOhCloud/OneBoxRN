package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import cloud.oneoh.oneboxn.core.ImportLink
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.LinkVerdict

// 扫码页真实状态：权限四态由系统权限 API 的检查/回调汇入驱动；
// 识别帧经唯一解析器 ImportLink.parse 判定，闩锁保证一次识别只处理一帧。
class ScanViewModel : ViewModel() {
    enum class Permission { CHECKING, ASKABLE, DENIED, GRANTED }

    var permission by mutableStateOf(Permission.CHECKING)
        private set

    // 识别失败告警可见性（拒绝分支：任一拒因同款告警）。
    var showRejected by mutableStateOf(false)
        private set

    // 闩锁：首个识别帧闩锁，后续帧一律忽略，直至重新武装。
    private var latched = false

    // 权限结果唯一汇入点（挂载检查 / 系统权限框回调 / 返回前台重查共用）：
    // 拒绝按「可再询问」与否分流 ASKABLE / DENIED。
    fun updatePermission(granted: Boolean, canAskAgain: Boolean) {
        permission = when {
            granted -> Permission.GRANTED
            canAskAgain -> Permission.ASKABLE
            else -> Permission.DENIED
        }
    }

    // 重新武装（相机起流时调用：首进本屏与从导入页返回都经此路径）。
    fun rearm() {
        latched = false
    }

    /**
     * 识别帧消费：闩锁后交 ImportLink.parse 唯一判定。
     * 接受 → 返回 payload 由宿主进导入；拒绝 → 弹识别失败告警并返回 null（确认后续扫）。
     */
    fun onQrRecognized(raw: String): ImportPayload? {
        if (latched) return null
        latched = true
        return when (val verdict = ImportLink.parse(raw)) {
            is LinkVerdict.Accepted -> verdict.payload
            is LinkVerdict.Rejected -> {
                showRejected = true
                null
            }
        }
    }

    // 告警确认：关闭告警并重新武装继续扫。
    fun confirmRejected() {
        showRejected = false
        latched = false
    }
}
