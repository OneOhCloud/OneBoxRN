package cloud.oneoh.oneboxn.bridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.SystemClock
import android.util.Log
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.Monitor
import cloud.oneoh.oneboxn.core.MonitorHandler
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.ObservationFreshness
import cloud.oneoh.oneboxn.core.ObservationHealth
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.tunnel.MonitorProtocol
import cloud.oneoh.oneboxn.tunnel.MonitorService

// UI 进程侧 Monitor：阶段/错误来自 :tun 的 TUNNEL_STATE 广播；
// 流量/分组/日志经 bindService 到 :tun 的 MonitorService + Messenger 拉取；selectNode/urlTest 反向命令
// 经同一 Messenger 回落到 :tun。不 import 任何引擎符号，只用中立契约 + tunnel 协议——UI 进程不加载引擎原生库。
class MonitorBinding(private val context: Context) : Monitor {

    @Volatile private var handler: MonitorHandler? = null
    private val statusState = EngineStatusState(EngineStatus.STOPPED)

    // bind 与隧道会话同生命周期;策略只发命令,副作用(bindService/postDelayed)在本类执行。
    private val bindPolicy = ObservationBindPolicy()
    private val bindHandler = Handler(Looper.getMainLooper())
    private val delayedUnbind = Runnable { onUnbindDelayElapsed() }
    private val delayedBindRetry = Runnable { retryBind() }

    @Volatile private var replyThread: HandlerThread? = null
    @Volatile private var replyMessenger: Messenger? = null
    private var replyGeneration = 0L
    @Volatile private var service: Messenger? = null
    private var bound = false
    @Volatile private var registered = false
    // 前台闸门：后台期不注册观察客户端（服务侧短路），进程启动即前台故默认 true。
    @Volatile private var uiForeground = true

    // 断流看门狗：已注册却收不到帧同样是通道失效，而 ServiceConnection 的回调对此沉默。
    // 判据与阈值取两端同一份 core 纯逻辑，本类只负责按节拍问、按结果发命令。
    private val staleWatchdog = Runnable { onStaleWatchdogTick() }
    private var lastFrameAtMillis: Long? = null
    private var staleReported = false
    private var health = ObservationHealth.IDLE

    // 阶段来自 :tun 服务生命周期广播（连接真相），与默认内核绑定同源。
    private val phaseFeed = TunnelPhaseFeed(BroadcastTunnelPhaseChannel(context))

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            binder ?: return
            connectService(binder)
        }

        // 服务进程死了而**绑定仍在**：系统会在服务回来时自动回调 onServiceConnected，
        // 故这里只清「已注册」标志。解绑重绑反而会把系统的自愈打断。
        override fun onServiceDisconnected(name: ComponentName?) {
            disconnectService()
            // 留痕并表态：系统的自动重连可能迟迟不来，而看门狗此刻因 `registered == false`
            // 已经停摆——不推这一次，应用内就再没有第二处能说出「通道断了」。
            reportChannelLost()
        }

        // 绑定本身已死，系统**不会**自动恢复：必须解绑后重绑。
        override fun onBindingDied(name: ComponentName?) {
            disconnectService()
            reportChannelLost()
            executeBindCommands(bindPolicy.onBindingDied())
        }

        // onBind 返回了 null：这次绑定不会有服务，解绑；不原地重试。
        override fun onNullBinding(name: ComponentName?) {
            disconnectService()
            executeBindCommands(bindPolicy.onNullBinding())
            publishHealth { it.withEndpoint(ObservationHealth.Endpoint.ABSENT) }
        }
    }

    @Synchronized
    override fun setHandler(handler: MonitorHandler) {
        this.handler = handler
        startReplyChannel()
        phaseFeed.open(::onPhaseSignal)
        // 契约不变量：挂载首个 onStatus 即当前状态。
        handler.onStatus(statusState.current())
        // 挂载同样推一次初始健康度：换绑定（切核）时消费方是同一个对象，它手里还攥着**上一条**
        // 绑定的帧时刻——不清掉，新通道首帧到达前的十几秒里页面显示的是上一条绑定的读数。
        health = ObservationHealth.IDLE
        handler.onObservationHealth(ObservationHealth.IDLE)
        // 挂载不 bind——bind 随会话相位走；reattach 的相位由相位收听开始后自己要的那次回放送达，
        // 上升沿触发 bind → register → 快照回放。
        executeBindCommands(bindPolicy.onPhase(statusState.current()))
    }

    override fun currentStatus(): EngineStatus = statusState.current()

    override fun lastError(): EngineError? = StartDiagnostic.read(context)

    override fun selectNode(tag: String) = sendCommand(MonitorProtocol.MSG_SELECT, tag)

    override fun urlTest(tag: String) = sendCommand(MonitorProtocol.MSG_URL_TEST, tag)

    @Synchronized
    override fun detachHandler() {
        // 契约保证之后不再有回调：先摘 handler，再断广播 + 解绑 MonitorService。
        // 解绑不停隧道（TunnelService 独立），故 detach 与 close 等价。
        handler = null
        phaseFeed.close()
        stopStaleWatchdog()
        bindHandler.removeCallbacks(delayedBindRetry)
        health = ObservationHealth.IDLE
        executeBindCommands(bindPolicy.onDetach())
        stopReplyChannel()
    }

    override fun close() = detachHandler()

    // 前台闸门：后台只注销观察客户端（保持 bind，反向命令不受影响），
    // 回前台重注册——MonitorService 注册即回放快照 + 补发 STARTED，不丢状态。
    @Synchronized
    fun setUiForeground(state: UiForegroundState) {
        uiForeground = state == UiForegroundState.FOREGROUND
        when (state) {
            UiForegroundState.FOREGROUND -> register()
            UiForegroundState.BACKGROUND -> unregisterClient()
        }
    }

    @Synchronized
    private fun register() {
        if (registered || !uiForeground) return
        val svc = service ?: return
        val reply = replyMessenger ?: return
        val sent = runCatching {
            svc.send(
                Message.obtain(null, MonitorProtocol.MSG_REGISTER).apply { replyTo = reply },
            )
        }.isSuccess
        registered = sent
        if (sent) {
            // 注册即回放快照，故看门狗从此刻起算而不是从「上一帧」起算。
            lastFrameAtMillis = SystemClock.elapsedRealtime()
            staleReported = false
            publishHealth { it.withEndpoint(ObservationHealth.Endpoint.BOUND).withStalled(false) }
            scheduleStaleWatchdog()
        }
    }

    @Synchronized
    private fun unregisterClient() {
        if (!registered) return
        val reply = replyMessenger
        service?.let {
            runCatching {
                it.send(
                    Message.obtain(null, MonitorProtocol.MSG_UNREGISTER).apply { replyTo = reply },
                )
            }
        }
        registered = false
        stopStaleWatchdog()
    }

    // 送不出去的命令要说出来：「点了节点 / 回了前台却什么都没发生」否则在两侧日志里都查不到。
    private fun sendCommand(what: Int, tag: String) {
        val svc = service ?: run {
            Log.w(TAG, "command $what for '$tag' not sent: monitor service is not connected")
            return
        }
        runCatching {
            svc.send(Message.obtain(null, what).apply { data = MonitorProtocol.tagPayload(tag) })
        }.onFailure { Log.w(TAG, "command $what for '$tag' not sent: ${it.javaClass.simpleName}: ${it.message}") }
    }

    private fun bindService() {
        if (bound) return
        bound = context.bindService(
            Intent(context, MonitorService::class.java),
            connection,
            Context.BIND_AUTO_CREATE,
        )
        if (bound) return
        // 系统说建不成有效连接：策略侧的 bound 必须跟着回退，否则同一个 STARTED 会话内再也
        // 不会发第二条 BIND。同时表态 + 定时再试——通道不许静默缺席。
        executeBindCommands(bindPolicy.onBindFailed())
        reportChannelLost()
        bindHandler.removeCallbacks(delayedBindRetry)
        bindHandler.postDelayed(delayedBindRetry, BIND_RETRY_MILLIS)
    }

    @Synchronized
    private fun retryBind() {
        if (handler == null) return
        executeBindCommands(bindPolicy.onPhase(statusState.current()))
    }

    private fun unbindService() {
        if (!bound) return
        unregisterClient()
        runCatching { context.unbindService(connection) }
        bound = false
        registered = false
        service = null
    }

    @Synchronized
    private fun onPhaseSignal(signal: TunnelPhaseSignal) {
        val changed = publishStatus(signal.status)
        if (changed && signal.status == EngineStatus.STARTED) register()
        if (signal.status == EngineStatus.STOPPED) signal.error?.let(::deliverError)
    }

    @Synchronized
    private fun publishStatus(next: EngineStatus): Boolean {
        if (!statusState.moveTo(next)) return false
        handler?.onStatus(next)
        // 相位迁移驱动 bind 会话（广播与查询回放同经此处，reattach 天然覆盖）。
        executeBindCommands(bindPolicy.onPhase(next))
        return true
    }

    @Synchronized
    private fun onUnbindDelayElapsed() {
        executeBindCommands(bindPolicy.onUnbindDelayElapsed())
    }

    @Synchronized
    private fun executeBindCommands(commands: List<ObservationBindPolicy.Command>) {
        for (command in commands) when (command) {
            ObservationBindPolicy.Command.BIND -> bindService()
            ObservationBindPolicy.Command.UNBIND -> unbindService()
            ObservationBindPolicy.Command.SCHEDULE_UNBIND ->
                bindHandler.postDelayed(delayedUnbind, ObservationBindPolicy.UNBIND_DELAY_MILLIS)
            ObservationBindPolicy.Command.CANCEL_UNBIND ->
                bindHandler.removeCallbacks(delayedUnbind)
            // 换一条绑定：策略侧 bound 保持 true，故中途不会有别的输入再补一条 BIND。
            ObservationBindPolicy.Command.REBIND -> {
                unbindService()
                bindService()
            }
        }
    }

    @Synchronized
    private fun publishReplyStatus(generation: Long, next: EngineStatus) {
        if (generation != replyGeneration) return
        publishStatus(next)
    }

    @Synchronized
    private fun connectService(binder: IBinder) {
        service = Messenger(binder)
        registered = false
        register()
    }

    @Synchronized
    private fun disconnectService() {
        service = null
        registered = false
    }

    @Synchronized
    private fun deliverTraffic(generation: Long, traffic: Traffic) {
        if (generation != replyGeneration) return
        noteFrameArrived()
        handler?.onTraffic(traffic)
    }

    // MARK: - 断流看门狗 / 健康度

    /**
     * 收帧即刷新时刻并解除断流。恢复也要推一次——呈现层靠推送翻转，不会因「时间又过去了」自己重算。
     */
    @Synchronized
    private fun noteFrameArrived() {
        lastFrameAtMillis = SystemClock.elapsedRealtime()
        if (!staleReported) return
        staleReported = false
        publishHealth { it.withStalled(false) }
    }

    private fun scheduleStaleWatchdog() {
        bindHandler.removeCallbacks(staleWatchdog)
        bindHandler.postDelayed(staleWatchdog, WATCHDOG_TICK_MILLIS)
    }

    private fun stopStaleWatchdog() {
        bindHandler.removeCallbacks(staleWatchdog)
        lastFrameAtMillis = null
        staleReported = false
    }

    @Synchronized
    private fun onStaleWatchdogTick() {
        // 前台闸门内不判断流：后台期观察客户端是被**有意**注销的，帧本就不该到，
        // 不设这道门会持续误报并触发无意义的重绑。
        if (!registered || !uiForeground) return
        if (!ObservationFreshness.isStale(lastFrameAtMillis, SystemClock.elapsedRealtime())) {
            scheduleStaleWatchdog()
            return
        }
        if (!staleReported) {
            staleReported = true
            reportChannelLost()
            executeBindCommands(bindPolicy.onFramesStale())
        }
        // 无条件重排，**即使**刚才已经发了重绑：重绑会经 unbind → register 自己再排一次，
        // 两条路径由 `scheduleStaleWatchdog` 的 removeCallbacks 归一，至多一个在途。
        // 反过来「发了重绑就不排」看着更省，却把看门狗的存活押在「重绑一定会发生」上——
        // 策略在 bound 为 false 时返回空命令列表，那一支就再也没人重排了。
        scheduleStaleWatchdog()
    }

    /** 通道失效的统一收口：置断流 + 记一次重建。**不**发命令——恢复手段由各调用点按语义选。 */
    @Synchronized
    private fun reportChannelLost() {
        // 必须同时置 stalled：只改 endpoint 的话，若最后一帧还不满 15 秒，消费方这次重算仍得
        // fresh，而其后不再有新值发射——第 15 秒永远不会触发 UI，也不会落断流那行日志。
        publishHealth {
            it.withEndpoint(ObservationHealth.Endpoint.ABSENT).withStalled(true).countingRebuild()
        }
    }

    /** 健康度变化的唯一出口：值没变就不推（避免 1 Hz 的无效重算）。 */
    @Synchronized
    private fun publishHealth(transform: (ObservationHealth) -> ObservationHealth) {
        val updated = transform(health)
        if (updated == health) return
        health = updated
        handler?.onObservationHealth(updated)
    }

    @Synchronized
    private fun deliverGroups(generation: Long, groups: List<NodeGroup>) {
        if (generation != replyGeneration) return
        handler?.onGroups(groups)
    }

    @Synchronized
    private fun deliverLogs(generation: Long, lines: List<LogLine>) {
        if (generation != replyGeneration) return
        handler?.onLogs(lines)
    }

    @Synchronized
    private fun deliverError(error: EngineError) {
        handler?.onError(error)
    }

    @Synchronized
    private fun isActiveReplyGeneration(generation: Long): Boolean = generation == replyGeneration

    @Synchronized
    private fun startReplyChannel() {
        if (replyMessenger != null) return
        val thread = HandlerThread("monitor-reply").apply { start() }
        replyGeneration++
        replyThread = thread
        replyMessenger = Messenger(ReplyHandler(thread.looper, replyGeneration))
    }

    @Synchronized
    private fun stopReplyChannel() {
        replyMessenger = null
        replyGeneration++
        replyThread?.quitSafely()
        replyThread = null
    }

    // MonitorService → UI 回包在专用 Looper 解码；MonitorHandler 契约允许后台线程回调。
    private inner class ReplyHandler(looper: Looper, private val generation: Long) : Handler(looper) {
        override fun handleMessage(msg: Message) {
            if (!isActiveReplyGeneration(generation)) return
            val data = msg.data ?: return
            when (msg.what) {
                // reattach（UI 重启而 :tun 仍在跑）：广播不重放，故 MonitorService 注册时经此补发运行状态，
                // 否则 UI 停留在本地默认 STOPPED、显示断开而 VPN 实际在运行。
                MonitorProtocol.MSG_STATUS -> {
                    publishReplyStatus(generation, MonitorProtocol.decodeStatus(data))
                }
                MonitorProtocol.MSG_TRAFFIC -> deliverTraffic(generation, MonitorProtocol.decodeTraffic(data))
                MonitorProtocol.MSG_GROUPS -> deliverGroups(generation, MonitorProtocol.decodeGroups(data))
                MonitorProtocol.MSG_LOG_BATCH -> deliverLogs(generation, MonitorProtocol.decodeLogBatch(data))
            }
        }
    }

    companion object {
        private const val TAG = "MonitorBinding"

        /**
         * 看门狗节拍：1 秒（与 Apple 侧的身份检查 deadline 同频）。
         * 判据本身在 core，本常量只是「多久问一次」，不是阈值。
         */
        private const val WATCHDOG_TICK_MILLIS = 1_000L

        /** `bindService` 返回 false 后的重试间隔：够稀疏不至于打转，也不至于让通道长期缺席。 */
        private const val BIND_RETRY_MILLIS = 5_000L
    }
}

enum class UiForegroundState { FOREGROUND, BACKGROUND }
