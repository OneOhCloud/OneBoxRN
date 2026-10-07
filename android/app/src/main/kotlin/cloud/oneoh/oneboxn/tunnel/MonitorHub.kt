package cloud.oneoh.oneboxn.tunnel

import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.Traffic

// :tun 进程内的引擎监视数据枢纽（进程单例）：EngineBinding 的观察订阅（同进程）把流量/分组/日志写入此处；
// MonitorService（同进程第二 Service）作为 sink 订阅并转发给 UI 进程的 Messenger 客户端。
// 反向命令（selectNode/urlTest）经 commandSink 回落到引擎。
// 用枢纽解耦两个 :tun 组件的生命周期：Service 的 bind 与引擎的 start 各自独立、次序不定。
object MonitorHub {

    interface Sink {
        fun onTraffic(traffic: Traffic)
        fun onGroups(groups: List<NodeGroup>)
        fun onLog(line: LogLine)
    }

    // 反向命令出口（selectOutbound 需 groupTag + outboundTag，urlTest 需 groupTag）。
    interface CommandSink {
        fun selectOutbound(groupTag: String, outboundTag: String)
        fun urlTest(groupTag: String)
    }

    @Volatile private var sink: Sink? = null
    @Volatile private var commandSink: CommandSink? = null

    // 用量采样器：装在这里而不是 UI 侧——UI 进程可被杀，隧道照常转发流量。
    // 由 TunnelService 随启动装入（带本次会话的记账归属）、随停止卸下。
    @Volatile private var usageRecorder: UsageRecorder? = null

    // 前台服务通知的渲染器：同样装在这里，理由相同——通知的存在理由就是 App 不在前台，
    // 而「无客户端即不投递」那道闸只短路「投递给 UI 进程」，本枢纽照常收帧。
    // **生命周期与采样器不同**：采样器是每引擎实例的（带记账归属，热重载要换），
    // 渲染器是服务级的——跟着重载卸了再装会让通知闪一下。
    @Volatile private var notificationRenderer: ServiceNotification? = null

    // 引擎是否在运行：由 EngineBinding start/stop 权威驱动。
    // reattach（UI 重启、:tun 仍在跑）时 MonitorService 据此补发 STARTED，否则 UI 停留在本地默认 STOPPED。
    @Volatile
    var running: Boolean = false
        private set

    // 最近快照，供 MonitorService 在 UI 客户端注册时回放（挂载即回放）。
    @Volatile
    var latestTraffic: Traffic? = null
        private set

    @Volatile
    var latestGroups: List<NodeGroup> = emptyList()
        private set

    // 会话峰值内存：:tun 进程常驻，UI 冻结/被杀期间照常累积，故为真会话峰值。
    @Volatile
    private var peakMemory: Long = 0

    // 重载窗口：换引擎期间抑制「停了一下」的观察语义——保留运行标志与最后一帧快照，
    // 由新引擎的首帧接管。窗口只影响 reset() 的清空面，不影响任何推送路径。
    @Volatile private var reloading: Boolean = false

    fun beginReload() {
        reloading = true
    }

    fun endReload() {
        reloading = false
    }

    fun setRunning(state: MonitorRunningState) {
        running = state == MonitorRunningState.RUNNING
    }

    fun attach(sink: Sink) {
        this.sink = sink
    }

    fun detach(sink: Sink) {
        if (this.sink === sink) this.sink = null
    }

    fun installCommandSink(commandSink: CommandSink) {
        this.commandSink = commandSink
    }

    /** 装入本次会话的用量采样器；未归属会话传 null，即不记账。 */
    internal fun installUsageRecorder(recorder: UsageRecorder?) {
        usageRecorder?.close()
        usageRecorder = recorder
    }

    /** 装入前台服务通知渲染器；`null` 即卸下，此后帧不再驱动通知。 */
    internal fun installNotificationRenderer(renderer: ServiceNotification?) {
        notificationRenderer = renderer
    }

    /** 停止沿：补提交剩余待提交量并释放 IO 通道。 */
    fun closeUsageRecorder() {
        usageRecorder?.close()
        usageRecorder = null
    }

    // 引擎每次 start 前重置：清空上一轮快照/命令出口/运行标志，避免跨启动陈旧（per-start，镜像 TunnelService）。
    fun reset() {
        commandSink = null
        // 会话峰值恒随引擎实例归零（一次 start 到 stop 为一个会话），重载也不例外。
        peakMemory = 0
        // 重载窗口内保留运行标志与最后一帧：那两样正是「用户不该看见这次换引擎」的落点。
        if (reloading) return
        running = false
        latestTraffic = null
        latestGroups = emptyList()
    }

    // —— 引擎观察写入（:tun，任意后台线程）——

    fun pushTraffic(traffic: Traffic) {
        // 峰值在枢纽盖章（负值 clamp，格式化层对负值 fail-fast），绑定映射保持无损透传。
        peakMemory = maxOf(peakMemory, maxOf(traffic.memory, 0))
        val stamped = traffic.copy(memoryPeak = peakMemory)
        latestTraffic = stamped
        // 记账只做锁内算术，IO 在采样器自己的串行通道上（数据面不做 IO）。
        usageRecorder?.observe(stamped)
        // 通知同理：这里只算呈现值并过主闸，notify() 在渲染器自己的串行通道上。
        notificationRenderer?.render(stamped, latestGroups)
        sink?.onTraffic(stamped)
    }

    fun pushGroups(groups: List<NodeGroup>) {
        latestGroups = groups
        notificationRenderer?.render(latestTraffic, groups)
        sink?.onGroups(groups)
    }

    fun pushLog(line: LogLine) {
        sink?.onLog(line)
    }

    // —— 反向命令（MonitorService 收到 UI 请求后调用）——

    // UI 只给出站 tag；组 tag 按最近分组快照反查（出站所在的组），查不到即空操作。
    fun selectNode(outboundTag: String) {
        val groupTag = latestGroups.firstOrNull { group -> group.nodes.any { it.tag == outboundTag } }?.tag
            ?: return
        commandSink?.selectOutbound(groupTag, outboundTag)
    }

    fun urlTest(groupTag: String) {
        commandSink?.urlTest(groupTag)
    }
}

enum class MonitorRunningState { RUNNING, STOPPED }
