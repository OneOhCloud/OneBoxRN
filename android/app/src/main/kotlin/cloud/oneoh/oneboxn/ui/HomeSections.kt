package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.components.ConnectPhase

// 首页私有的相位映射：连接状态 → 电源砖相位、页顶晕染与状态行文案。

/** 引擎/隧道状态 → 呈现相位。断开中与切换中同归 `SWITCHING`（呈现上是同一态）。 */
internal fun HomeViewModel.HeroState.toConnectPhase(): ConnectPhase = when (this) {
    HomeViewModel.HeroState.DISCONNECTED -> ConnectPhase.IDLE
    HomeViewModel.HeroState.CONNECTING -> ConnectPhase.CONNECTING
    HomeViewModel.HeroState.CONNECTED -> ConnectPhase.CONNECTED
    HomeViewModel.HeroState.DISCONNECTING -> ConnectPhase.SWITCHING
    HomeViewModel.HeroState.START_FAILED -> ConnectPhase.FAILED
}

/** 页顶晕染跟着电源砖走：蓝色只属于「已连接」。连接中的砖还是未连接的样子，页面不先一步变蓝。 */
internal fun HomeViewModel.HeroState.pageTint(): PageTint =
    if (this == HomeViewModel.HeroState.CONNECTED) PageTint.Accent else PageTint.Neutral

@Composable
internal fun connectStatusText(phase: ConnectPhase): String = stringResource(
    when (phase) {
        ConnectPhase.IDLE -> R.string.home_disconnected
        ConnectPhase.CONNECTING -> R.string.home_connecting
        ConnectPhase.CONNECTED -> R.string.home_connected
        ConnectPhase.SWITCHING -> R.string.home_switching
        ConnectPhase.FAILED -> R.string.home_start_failed
    },
)
