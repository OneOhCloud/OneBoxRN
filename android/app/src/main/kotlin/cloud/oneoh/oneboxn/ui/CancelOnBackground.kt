package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/**
 * App 进入后台时执行 [onBackground]。
 *
 * **`DisposableEffect` 盖不住这一条**：按 Home 键不会让 composable 离屏，页面还在导航栈里，
 * `onDispose` 根本不触发，测速与 NAT 探测会在后台照常跑下去（承载服务仍绑着连接）。
 *
 * 判据取 `ON_STOP`（App 不再可见）而不是 `ON_PAUSE`：后者在弹层遮挡、分屏失焦时也会触发，
 * 按它取消等于弹个确认框就把测量掐了。这与 Apple 侧只认 `.background`、不认 `.inactive`
 * 是同一条取向。
 *
 * 提炼成共用件而不是各页抄一份：两页的要求是同一句话，抄两份迟早只改其中一份。
 */
@Composable
fun CancelOnBackground(onBackground: () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) onBackground()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
}
