package cloud.oneoh.oneboxn.bridge

import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.EngineStatus

/** :tun 发来的一拍相位；[error] 只随失败收口的 STOPPED 同行。 */
internal data class TunnelPhaseSignal(val status: EngineStatus, val error: EngineError?)

/** :tun 相位广播的收听端口；Android 实现见 [BroadcastTunnelPhaseChannel]。 */
internal interface TunnelPhaseChannel {
    fun listen(onSignal: (TunnelPhaseSignal) -> Unit)

    fun stopListening()

    /** 请 :tun 把当前相位再广播一拍；:tun 不在时无人应答。 */
    fun requestReplay()
}

/**
 * UI 进程对 :tun 相位的收听。
 *
 * 相位广播不粘滞：开始收听之前发出的每一拍——包括别的组件那次状态查询的回复——这里都收不到。
 * UI 进程重建时隧道若已在跑，这里能拿到的 STARTED 只可能来自开始收听**之后**的一次回放；
 * 故回放由本类自己在开始收听之后发起，不指望别的组件的查询恰好晚于这一刻。
 */
internal class TunnelPhaseFeed(private val channel: TunnelPhaseChannel) {
    private var listening = false

    fun open(onSignal: (TunnelPhaseSignal) -> Unit) {
        if (listening) return
        channel.listen(onSignal)
        listening = true
        channel.requestReplay()
    }

    fun close() {
        if (!listening) return
        channel.stopListening()
        listening = false
    }
}
