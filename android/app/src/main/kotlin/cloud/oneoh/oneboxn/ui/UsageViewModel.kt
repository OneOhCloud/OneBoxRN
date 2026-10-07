package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.core.UsageHistory
import cloud.oneoh.oneboxn.core.UsageSeries
import cloud.oneoh.oneboxn.core.UsageTier
import cloud.oneoh.oneboxn.usage.projectUsage
import kotlinx.coroutines.launch

// 本机用量页：进入读一次、回前台读一次，不轮询——账本每分钟才变一次。
// 档位切换只重投影，不重新读盘（三档来自同一份已读入的账本）。
class UsageViewModel(
    private val actions: AppActions,
    private val profileId: String,
    private val nowMillis: () -> Long = System::currentTimeMillis,
) : ViewModel() {

    var tier by mutableStateOf(UsageTier.TODAY)
        private set

    var series by mutableStateOf(EMPTY_SERIES)
        private set

    /** 该配置尚无账本文件 → 空态；与「这一档没用过」是两回事（后者仍展示零值区间）。 */
    var hasRecord by mutableStateOf(false)
        private set

    var loaded by mutableStateOf(false)
        private set

    private var history = UsageHistory.EMPTY

    init {
        refresh()
    }

    fun select(next: UsageTier) {
        tier = next
        series = project()
    }

    fun refresh() {
        viewModelScope.launch {
            val snapshot = actions.usageRecord(profileId)
            hasRecord = snapshot.hasRecord
            history = snapshot.history
            series = project()
            loaded = true
        }
    }

    private fun project(): UsageSeries = projectUsage(history, tier, nowMillis())

    private companion object {
        val EMPTY_SERIES = UsageSeries(emptyList(), 0, 0)
    }
}
