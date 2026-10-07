package cloud.oneoh.oneboxn.tunnel

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.util.Log
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.Traffic
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

// :tun 进程第二 Service（Messenger 端，exported=false）：把 MonitorHub 的流量/分组/日志
// 转发给已注册的 UI 客户端，并把 UI 的 selectNode/urlTest 反向命令回落到引擎（经 hub）。
// BIND_VPN_SERVICE 系统权限只挂在 TunnelService 上，本 Service 不带该权限，故 UI 可正常 bind
// （桥不能挂在带系统权限的 VpnService 上）。
class MonitorService : Service(), MonitorHub.Sink {

    // 客户端集合（UI 回包 Messenger）；DeadObject 即移除。CopyOnWriteArraySet 容忍回调线程并发遍历。
    private val clients = CopyOnWriteArraySet<Messenger>()
    private val incoming = Messenger(IncomingHandler())

    // 反向命令（selectNode/urlTest）落到引擎命令通道，可能阻塞——移出 Messenger 主循环，避免卡住消息处理。
    private val commandExecutor = Executors.newSingleThreadExecutor()
    private val logExecutor = ScheduledThreadPoolExecutor(1) { task -> Thread(task, "monitor-log-batch") }.apply {
        removeOnCancelPolicy = true
        executeExistingDelayedTasksAfterShutdownPolicy = false
    }
    private val logBatcher = MonitorLogBatcher()
    private var scheduledLogFlush: ScheduledFuture<*>? = null

    override fun onCreate() {
        super.onCreate()
        MonitorHub.attach(this)
    }

    override fun onBind(intent: Intent?): IBinder = incoming.binder

    override fun onDestroy() {
        MonitorHub.detach(this)
        clients.clear()
        haltLogPump()
        logExecutor.shutdownNow()
        commandExecutor.shutdown()
        super.onDestroy()
    }

    // —— MonitorHub.Sink（引擎观察线程投递）——

    // 三条投递路径同构：无客户端即不做无消费者的工作。流量/分组直接短路；
    // 日志经批处理泵，泵在客户端集合清空的沿上停摆，入储门槛由泵单点持有。
    override fun onTraffic(traffic: Traffic) {
        if (clients.isEmpty()) return
        broadcast(MonitorProtocol.MSG_TRAFFIC, MonitorProtocol.encodeTraffic(traffic))
    }

    override fun onGroups(groups: List<NodeGroup>) {
        if (clients.isEmpty()) return
        val payload = MonitorProtocol.encodeGroups(groups) ?: return
        broadcast(MonitorProtocol.MSG_GROUPS, payload)
    }

    override fun onLog(line: LogLine) = enqueueLog(line)

    @Synchronized
    private fun enqueueLog(line: LogLine) {
        logBatcher.offer(line)
        if (logBatcher.hasPending) scheduleLogFlush()
    }

    @Synchronized
    private fun resumeLogPump() {
        logBatcher.resume()
    }

    /** 客户端集合清空的沿：取消未决冲刷并丢弃待发送队列，不为无人消费的批次做编码。 */
    @Synchronized
    private fun haltLogPump() {
        scheduledLogFlush?.cancel(false)
        scheduledLogFlush = null
        logBatcher.halt()
    }

    private fun scheduleLogFlush() {
        if (scheduledLogFlush != null || logExecutor.isShutdown) return
        scheduledLogFlush = logExecutor.schedule(
            ::flushLogBatch,
            LOG_BATCH_INTERVAL_MILLIS,
            TimeUnit.MILLISECONDS,
        )
    }

    private fun flushLogBatch() {
        val lines = synchronized(this) {
            scheduledLogFlush = null
            val batch = logBatcher.drain()
            if (logBatcher.hasPending) scheduleLogFlush()
            batch
        }
        broadcastLogBatch(lines)
    }

    private fun broadcastLogBatch(lines: List<LogLine>) {
        // 冲刷与停摆可交错：最后一个客户端恰在本次 drain 之后离场时，这里挡住最后一次无谓编码。
        if (lines.isEmpty() || clients.isEmpty()) return
        val payload = MonitorProtocol.encodeLogBatch(lines) ?: return
        broadcast(MonitorProtocol.MSG_LOG_BATCH, payload)
    }

    private fun broadcast(what: Int, data: Bundle) {
        for (client in clients) {
            if (!send(client, what, data)) forget(client)
        }
    }

    /** 客户端离场（主动注销或 DeadObject）；最后一个离场即让日志批处理泵停摆。 */
    private fun forget(client: Messenger) {
        clients.remove(client)
        if (clients.isEmpty()) haltLogPump()
    }

    private fun send(client: Messenger, what: Int, data: Bundle): Boolean =
        try {
            client.send(Message.obtain(null, what).apply { this.data = data })
            true
        } catch (dead: RemoteException) {
            // 观察面故障不升级为数据面故障，但也不许不留证据：调用方据此把
            // 这个客户端摘出广播集合，从此 UI 再不更新，而连接真相仍是「已连接」——不留这一行，
            // 故障从发生到用户报告之间无人可见。
            Log.w(TAG, "observation client dropped: send failed", dead)
            false
        }

    private inner class IncomingHandler : Handler(Looper.getMainLooper()) {
        override fun handleMessage(msg: Message) {
            when (msg.what) {
                MonitorProtocol.MSG_REGISTER -> register(msg.replyTo)
                MonitorProtocol.MSG_UNREGISTER -> msg.replyTo?.let(::forget)
                MonitorProtocol.MSG_SELECT ->
                    tagOf(msg)?.let { tag -> commandExecutor.execute { MonitorHub.selectNode(tag) } }
                MonitorProtocol.MSG_URL_TEST ->
                    tagOf(msg)?.let { tag -> commandExecutor.execute { MonitorHub.urlTest(tag) } }
                else -> Log.w(TAG, "unknown message ${msg.what}")
            }
        }

        // 无 tag 的命令一律丢弃，但要说出来——与同函数的 unknown message 同一档，
        // 否则「点了节点却什么都没发生」在两侧日志里都查不到。
        private fun tagOf(msg: Message): String? {
            val tag = MonitorProtocol.tagOf(msg.data)
            if (tag == null) Log.w(TAG, "command ${msg.what} without tag")
            return tag
        }
    }

    private fun register(client: Messenger?) {
        client ?: return
        clients.add(client)
        resumeLogPump()
        // 挂载即回放最近快照，满足 UI 重挂立即有数据；running 时补发 STARTED（reattach 无广播可依）。
        if (MonitorHub.running) {
            send(client, MonitorProtocol.MSG_STATUS, MonitorProtocol.encodeStatus(EngineStatus.STARTED))
        }
        MonitorHub.latestTraffic?.let {
            send(client, MonitorProtocol.MSG_TRAFFIC, MonitorProtocol.encodeTraffic(it))
        }
        val groups = MonitorHub.latestGroups
        if (groups.isNotEmpty()) {
            MonitorProtocol.encodeGroups(groups)?.let { send(client, MonitorProtocol.MSG_GROUPS, it) }
        }
    }

    private companion object {
        const val TAG = "MonitorService"
        const val LOG_BATCH_INTERVAL_MILLIS = 100L
    }
}
