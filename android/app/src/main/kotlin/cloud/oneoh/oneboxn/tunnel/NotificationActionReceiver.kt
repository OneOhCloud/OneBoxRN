package cloud.oneoh.oneboxn.tunnel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import cloud.oneoh.oneboxn.App

/**
 * 前台服务通知上「断开」键的落点。
 *
 * **本类跑在主进程**，与同目录其余文件（`:tun`）不同进程——manifest 里不带 `android:process`
 * 即落主进程，那正是 `AppActions` 所在处。放在 `tunnel/` 是因为它属于通知这件事，
 * 与同样跨两进程的 [TunnelSignals] 同一先例；进程归属只能靠这段注释与 manifest 说清楚。
 *
 * 走 `AppActions.disconnect()` 而不是直接向 `:tun` 广播 `ACTION_STOP`：后者绕开连接意图闸门与
 * 待用启动配置的回收，UI 侧因此看不见「用户已表示不想连」，在途的那次连接可能继续跑完。
 * 副作用与首页英雄键、快捷设置磁贴逐条相同。
 *
 * **不用 `goAsync()`**：同进程广播串行投递，撑着本条会把 `:tun` 回发的广播堵在后面，
 * 以致死锁。`disconnect()` 本就是同步的。
 */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_DISCONNECT) return
        (context.applicationContext as App).actions.disconnect()
    }

    internal companion object {
        const val ACTION_DISCONNECT = "cloud.oneoh.oneboxn.action.NOTIFICATION_DISCONNECT"
    }
}
