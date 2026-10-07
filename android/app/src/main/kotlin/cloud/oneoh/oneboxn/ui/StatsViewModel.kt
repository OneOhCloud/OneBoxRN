package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.core.ByteParts
import cloud.oneoh.oneboxn.core.MemoryTrend
import cloud.oneoh.oneboxn.core.TrafficFormat
import cloud.oneoh.oneboxn.core.TrafficRateTrend
import kotlinx.coroutines.launch

// 运行统计：注入 AppActions，把动作层 StateFlow 投影为 snapshot state。
// 与首页会话卡同源同拍（同一 Traffic 快照）；本页零引擎调用、零持久化。
// connected 是唯一门控：未连接时 Traffic 会停在最后一帧，故视图必须走空态而非展示陈旧数字。
class StatsViewModel(private val actions: AppActions) : ViewModel() {
    var connected by mutableStateOf(actions.connected.value)
        private set
    var traffic by mutableStateOf(actions.traffic.value)
        private set

    /** 趋势窗口由会话级 TunnelClient 持有并逐帧追加，此处只读投影——页面进出不清零。 */
    var memoryTrend by mutableStateOf(actions.memoryTrend.value)
        private set

    /** 网速时间窗同为会话级持有，此处只读投影。 */
    var rateTrend by mutableStateOf(actions.rateTrend.value)
        private set

    /**
     * 已连接但观察通道断流——读数不再可信，全页数值走占位而非陈旧数字。
     * 连接门控与新鲜度门控是两道独立的闸，缺任一道都会谎报。
     */
    var stale by mutableStateOf(actions.trafficStale())
        private set

    /** 断流期投影为空窗——那些样本描述的是十几秒前，继续画就是把它当成此刻的走势。 */
    val displayMemoryTrend: MemoryTrend
        get() = if (stale) MemoryTrend.EMPTY else memoryTrend

    val displayRateTrend: TrafficRateTrend
        get() = if (stale) TrafficRateTrend.EMPTY else rateTrend

    /** 会话峰值优先（隧道进程枢纽盖章的真值），0 表示尚无帧，降级趋势窗口峰值。 */
    val memoryPeak: String
        get() = fresh {
            TrafficFormat.bytes(if (traffic.memoryPeak > 0) traffic.memoryPeak else memoryTrend.peak)
        }

    /** 内存的数值与单位走 core TrafficFormat 单一来源（与主页速率同实现）。 */
    val memoryParts: ByteParts
        get() = if (stale) ByteParts(PLACEHOLDER, "") else TrafficFormat.bytesParts(traffic.memory)

    val uploadRate: String get() = fresh { TrafficFormat.rate(traffic.up) }
    val downloadRate: String get() = fresh { TrafficFormat.rate(traffic.down) }

    /** 连接数为纯整数不加单位。 */
    val connectionsIn: String get() = fresh { traffic.connIn.toString() }
    val connectionsOut: String get() = fresh { traffic.connOut.toString() }

    /** 一处判、一处占位：六项读数各自 `if (stale)` 会把同一条规则抄六遍。 */
    private inline fun fresh(value: () -> String): String = if (stale) PLACEHOLDER else value()

    init {
        viewModelScope.launch {
            actions.connected.collect { connected = it }
        }
        viewModelScope.launch {
            actions.traffic.collect { traffic = it }
        }
        viewModelScope.launch {
            actions.memoryTrend.collect { memoryTrend = it }
        }
        viewModelScope.launch {
            actions.rateTrend.collect { rateTrend = it }
        }
        // 断流态靠**推送**驱动重算：时间流逝不改变任何 StateFlow 的值，只在 getter 里比时间的话
        // 第 15 秒永远不会自己到来。健康度与帧时刻各自的发射就是那两个触发源。
        viewModelScope.launch {
            actions.observationHealth.collect { stale = actions.trafficStale() }
        }
        viewModelScope.launch {
            actions.lastFrameAtMillis.collect { stale = actions.trafficStale() }
        }
    }

    companion object {
        /** 读数不可信时的统一占位（首页会话卡同用这一个）。0 不能拿来顶替——0 是「内核确实产了 0」的合法值。 */
        const val PLACEHOLDER = "—"
    }
}
