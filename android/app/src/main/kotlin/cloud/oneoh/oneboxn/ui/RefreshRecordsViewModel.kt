package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.core.RefreshRecord

// 更新记录页状态：时间线快照 + 当前打开的详情。
// 记录只在抓取终点追加，页面在进入时取一次快照即可——不为一个诊断页挂常驻观察。
// 镜像 iOS App/UI/RefreshRecordsViewModel.swift。
class RefreshRecordsViewModel(actions: AppActions) : ViewModel() {
    val timeline: List<RefreshRecord> = actions.refreshRecordTimeline()

    /** 打开详情的那条记录；null = 未打开（详情是弹层，不是路由）。 */
    var detail by mutableStateOf<RefreshRecord?>(null)
        private set

    fun openDetail(record: RefreshRecord) {
        detail = record
    }

    fun dismissDetail() {
        detail = null
    }
}
