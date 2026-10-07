package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.AppActions
import kotlinx.coroutines.launch

// 开发者页状态：两个开关的乐观本地态 + 持久化转发。
// 状态属性带 Enabled 后缀：不带的话它生成的 JVM setter 与下面的 setXxx 同签名，编译不过。
// 镜像 iOS App/UI/DevViewModel.swift。
class DevViewModel(private val actions: AppActions) : ViewModel() {
    var forceFallbackEnabled by mutableStateOf(actions.forceFallback())
        private set

    var backgroundRefreshEnabled by mutableStateOf(actions.backgroundRefresh())
        private set

    /** 翻转即持久化，不弹确认（与选核切换一样立即生效）。 */
    fun setForceFallback(enabled: Boolean) {
        forceFallbackEnabled = enabled
        actions.setForceFallback(enabled)
    }

    /** 翻转即持久化并即刻同步周期任务的注册/注销。 */
    fun setBackgroundRefresh(enabled: Boolean) {
        backgroundRefreshEnabled = enabled
        actions.setBackgroundRefresh(enabled)
    }

    // MARK: - 观察通道健康度（只读，零命令、零持久化、零轮询）

    /** 未连接时三项均为占位「—」：那时本就没有通道，报 absent 会让人以为出了故障。 */
    var observationEndpoint by mutableStateOf(PLACEHOLDER)
        private set

    var observationLastFrame by mutableStateOf(PLACEHOLDER)
        private set

    var observationRebuilds by mutableStateOf(PLACEHOLDER)
        private set

    init {
        // 取数复用观察健康度已有的推送，不新开观察路径、不独立轮询（与运行统计页同姿态）。
        viewModelScope.launch { actions.connected.collect { refreshObservation() } }
        viewModelScope.launch { actions.observationHealth.collect { refreshObservation() } }
        viewModelScope.launch { actions.lastFrameAtMillis.collect { refreshObservation() } }
    }

    private fun refreshObservation() {
        if (!actions.connected.value) {
            observationEndpoint = PLACEHOLDER
            observationLastFrame = PLACEHOLDER
            observationRebuilds = PLACEHOLDER
            return
        }
        val health = actions.observationHealth.value
        observationEndpoint = health.endpoint.token
        observationLastFrame = actions.observationElapsedMillis()
            ?.let { "${it / 1000}s" }
            ?: PLACEHOLDER
        observationRebuilds = health.rebuildCount.toString()
    }

    private companion object {
        const val PLACEHOLDER = "—"
    }
}
