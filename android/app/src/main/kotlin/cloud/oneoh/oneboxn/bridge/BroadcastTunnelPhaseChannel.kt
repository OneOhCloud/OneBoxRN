package cloud.oneoh.oneboxn.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.tunnel.TunnelSignals

/** 经 ACTION_STATE 收听、经 ACTION_QUERY_STATE 请求回放的相位通道（UI 进程侧）。 */
internal class BroadcastTunnelPhaseChannel(private val context: Context) : TunnelPhaseChannel {
    private var receiver: BroadcastReceiver? = null

    override fun listen(onSignal: (TunnelPhaseSignal) -> Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                // 相位来自本仓自己的 `:tun` 广播（NOT_EXPORTED + setPackage，别人发不进来）：
                // 缺失或映射不到枚举都是跨进程装配 bug——崩溃暴露。静默 return 会把随行的 ERROR_TOKEN/DETAIL 一并丢掉，
                // UI 永久停在上一相位而无人知道为什么。
                val phase = intent.getStringExtra(TunnelSignals.EXTRA_PHASE) ?: error("missing tunnel phase extra")
                val error = intent.getStringExtra(TunnelSignals.EXTRA_ERROR_TOKEN)
                    ?.let { EngineError(it, intent.getStringExtra(TunnelSignals.EXTRA_ERROR_DETAIL)) }
                onSignal(TunnelPhaseSignal(EngineStatus.valueOf(phase), error))
            }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(TunnelSignals.ACTION_STATE),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        this.receiver = receiver
    }

    override fun stopListening() {
        val receiver = receiver ?: return
        runCatching { context.unregisterReceiver(receiver) }
        this.receiver = null
    }

    override fun requestReplay() {
        context.sendBroadcast(TunnelSignals.queryState(context.packageName))
    }
}
