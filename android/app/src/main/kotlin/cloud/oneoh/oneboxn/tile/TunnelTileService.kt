package cloud.oneoh.oneboxn.tile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat
import cloud.oneoh.oneboxn.App
import cloud.oneoh.oneboxn.MainActivity
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.TunnelSessionPhase
import cloud.oneoh.oneboxn.core.sessionPhase
import cloud.oneoh.oneboxn.tunnel.TunnelSignals

// 快捷设置磁贴：不打开 App 就能看到连没连、并把它翻过来。
//
// 与 App 同进程，故直接用既有动作层：磁贴不自写启停、不自写配置装配、不持有状态。
// 呈现与点按去向都从同一个谓词导出——`sessionPhase != NOT_RUNNING`，判据在 core。
class TunnelTileService : TileService() {

    private val actions get() = (application as App).actions

    private var listening = false

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            renderTile()
        }
    }

    // 只在面板打开期间订阅：合上就注销，磁贴不在后台养一个接收器。
    override fun onStartListening() {
        super.onStartListening()
        if (!listening) {
            ContextCompat.registerReceiver(
                this,
                stateReceiver,
                IntentFilter(TunnelSignals.ACTION_STATE),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            listening = true
        }
        // 广播不粘性：面板刚打开这一拍必须主动问一次，否则磁贴显示的是上一次留下的样子。
        sendBroadcast(TunnelSignals.queryState(packageName))
        renderTile()
    }

    override fun onStopListening() {
        if (listening) {
            runCatching { unregisterReceiver(stateReceiver) }
            listening = false
        }
        super.onStopListening()
    }

    override fun onClick() {
        // 前置不满足就把用户带进 App，不在磁贴上静默失败、也不弹 toast
        //（面板收起时机由系统定，toast 常在用户已看不到面板时才出现）。
        //
        // 只有这一支要先解锁——锁屏上摆不出 Activity；启停本身照常执行，
        // 首次解锁后凭证加密存储即可读，配置内容拿得到。
        if (needsAppForClick()) {
            if (isLocked) unlockAndRun(::openApp) else openApp()
            return
        }
        // 按当前呈现态翻转，而不是 `toggle()`——后者只看「已连接」，
        // 连接中再点会**再发起一次连接**；磁贴没有禁用态，必须支持改主意。
        if (isShownActive()) actions.disconnect() else actions.connect()
        renderTile()
    }

    /** 无可用启动数据或缺系统 VPN 授权。授权 Intent 必须由 Activity 承接，磁贴不是 Activity。 */
    private fun needsAppForClick(): Boolean {
        if (VpnService.prepare(this) != null) return true
        // 数据仓库尚在预热时 profiles 还是空的，但那不等于「没有配置」。
        // 只在**确知已加载完**且真的没有激活配置时才判前置不满足，否则一次正常的冷启动
        // 会被误报成「你还没导入配置」。
        return actions.dataLoaded.value && actions.activeProfile.value == null
    }

    private fun openApp() {
        // 落点：带上系统长按用的同一个 action，MainActivity 据此把 tab 落回主页。
        // 从磁贴过来的人要的是 App 的正面，而这一支要承接的引导（导入、授权）也在那里；
        // 不为「从磁贴来的」另造第二个标记，判据只有 requestsHomeTab 一处。
        val intent = Intent(this, MainActivity::class.java)
            .setAction(TileService.ACTION_QS_TILE_PREFERENCES)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // API 34 起 Intent 重载已废弃且会抛 UnsupportedOperationException，必须给 PendingIntent。
            startActivityAndCollapse(
                PendingIntent.getActivity(
                    this,
                    0,
                    intent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun isShownActive(): Boolean = phase() != TunnelSessionPhase.NOT_RUNNING

    private fun phase(): TunnelSessionPhase = sessionPhase(
        osConnected = actions.connected.value,
        engineStatus = actions.status.value,
    )

    private fun renderTile() {
        val tile = qsTile ?: return
        tile.state = if (isShownActive()) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(R.string.tile_label)
        // API 28 无副标题位：只呈现开 / 关，不自绘补一个——那会破坏磁贴的系统件外观。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = getString(tileSubtitleResId(phase(), actions.status.value))
        }
        tile.updateTile()
    }
}

/**
 * 磁贴副标题：呈现全部是连接真相的**只读投影**。
 *
 * **主体只看 `TunnelSessionPhase`**，与开关态同源；`EngineStatus` 只细化「连接中/断开中」过渡态文案，
 * 不作连接真相。否则 OS 已连接而引擎阶段还没跟上的那一拍（`osConnected = true · engineStatus = STOPPED`）
 * 会让同一块磁贴亮着、却写着「未连接」。
 *
 * 「断开中」那一档不能靠 `sessionPhase` 出：它把 `STOPPING` 归进 `NOT_RUNNING`，照搬会丢掉一档文案。
 * 故 `NOT_RUNNING` 内部再问一次 `EngineStatus`——那一问只产出过渡态文案。
 */
internal fun tileSubtitleResId(phase: TunnelSessionPhase, engineStatus: EngineStatus): Int =
    when (phase) {
        TunnelSessionPhase.RUNNING -> R.string.tile_state_connected
        TunnelSessionPhase.STARTING -> R.string.tile_state_connecting
        TunnelSessionPhase.NOT_RUNNING -> when (engineStatus) {
            EngineStatus.STOPPING -> R.string.tile_state_disconnecting
            else -> R.string.tile_state_disconnected
        }
    }
