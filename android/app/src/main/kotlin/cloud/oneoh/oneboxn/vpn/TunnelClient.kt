package cloud.oneoh.oneboxn.vpn

import android.os.SystemClock
import cloud.oneoh.oneboxn.LogSource
import cloud.oneoh.oneboxn.LogStore
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.FailureSource
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.MemoryTrend
import cloud.oneoh.oneboxn.core.Monitor
import cloud.oneoh.oneboxn.core.MonitorHandler
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.ObservationFreshness
import cloud.oneoh.oneboxn.core.ObservationHealth
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.core.TrafficRateTrend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// 消费 Monitor 契约 → StateFlow。回调可能在任意后台线程；
// StateFlow.value 写入线程安全，Compose 侧 collectAsState 在主线程消费。
//
// elapsedRealtimeMillis 是网速时间窗的时钟：必须单调且**计入系统睡眠**——nanoTime 不计深睡，
// 挂起恢复后算出的间隔远小于真实间隔，时间窗等于没有。参数化是为了单测可控（android.os 在 JVM 单测不可用）。
class TunnelClient(
    monitor: Monitor,
    private val logStore: LogStore,
    private val elapsedRealtimeMillis: () -> Long = SystemClock::elapsedRealtime,
) : MonitorHandler {
    private val monitor: Monitor = monitor

    private val _status = MutableStateFlow(EngineStatus.STOPPED)
    val status: StateFlow<EngineStatus> = _status.asStateFlow()

    private val _traffic = MutableStateFlow(EMPTY_TRAFFIC)
    val traffic: StateFlow<Traffic> = _traffic.asStateFlow()

    private val _groups = MutableStateFlow<List<NodeGroup>>(emptyList())
    val groups: StateFlow<List<NodeGroup>> = _groups.asStateFlow()

    // 引擎分组推送计数（乐观选中的回摆判据）：groups 本身是 StateFlow，内容相等即不再发射，
    // 而切换未生效时推上来的恰恰是同一份快照——只观察 groups 会让乐观值永久滞留，故单设计数。
    private val _groupsGeneration = MutableStateFlow(0)
    val groupsGeneration: StateFlow<Int> = _groupsGeneration.asStateFlow()

    // 内存趋势的会话级持有者：随帧追加、随停止清空，页面 ViewModel 只读投影。
    private val _memoryTrend = MutableStateFlow(MemoryTrend.EMPTY)
    val memoryTrend: StateFlow<MemoryTrend> = _memoryTrend.asStateFlow()

    // 网速趋势的会话级持有者：同一帧追加、同一时机清空；窗口按时间而非拍数收敛。
    private val _rateTrend = MutableStateFlow(TrafficRateTrend.EMPTY)
    val rateTrend: StateFlow<TrafficRateTrend> = _rateTrend.asStateFlow()

    // 读时刻与追加必须同处一把锁：StateFlow 的单次读写线程安全，但「读旧值 → 追加 → 写回」不是
    // 原子的。两个回调交错时，先读时刻的那个后写回，就会拿更早的时刻去追加，撞上
    // 「时刻不得倒退」直接崩溃（回调按契约可能来自任意后台线程）。
    private val rateTrendLock = Any()

    // 启动失败诊断的 Monitor 通道：持久化诊断作挂载兜底，onError 事件在线更新；
    // 成功启动（STARTED）即清空。广播通道见 TunnelController，两通道在 AppActions 合并。
    //
    // 观察时刻与诊断同为一个值（FailureDiagnostic）：**只在 App 亲眼观察到失败的那一拍打点**，
    // 挂载读到的持久化诊断没有可信时刻故留 null，弹层时间行占位「—」（不谎称）。
    private val _failure = MutableStateFlow(
        // 来源 = 引擎：这一份是引擎自己写下的启动错误（失败诊断第 1 级），经 Monitor 读出。
        monitor.lastError()?.let { FailureDiagnostic(it, null, FailureSource.ENGINE) },
    )
    val failure: StateFlow<FailureDiagnostic?> = _failure.asStateFlow()

    /**
     * 用户主动断开是诊断的边界 —— 清掉 Monitor 通道上这一段留下的失败诊断。
     *
     * 只给用户主动断开用，不要挂到别的停止沿上：失败收口自己也会停隧道，
     * 而那一沿正需要诊断活着给失败弹层看。两种停止在代码里长得一样，区别只在谁发起。
     */
    fun clearFailure() {
        _failure.value = null
    }

    // 观察通道健康度：由通道层主动推，**不是**这里按时间自己算出来的。
    private val _observationHealth = MutableStateFlow(ObservationHealth.IDLE)
    val observationHealth: StateFlow<ObservationHealth> = _observationHealth.asStateFlow()

    // 本次会话最近一帧的到达时刻；null = 本次会话尚无任何帧。时钟与网速时间窗同一份。
    private val _lastFrameAtMillis = MutableStateFlow<Long?>(null)
    val lastFrameAtMillis: StateFlow<Long?> = _lastFrameAtMillis.asStateFlow()

    init {
        monitor.setHandler(this)
    }

    override fun onStatus(status: EngineStatus) {
        _status.value = status
        if (status == EngineStatus.STARTED) {
            _failure.value = null
        }
        // 停止即清空两块趋势，不跨连接会话保留（traffic 本身停在最后一帧）。
        if (status == EngineStatus.STOPPED) {
            synchronized(rateTrendLock) {
                _memoryTrend.value = MemoryTrend.EMPTY
                _rateTrend.value = TrafficRateTrend.EMPTY
                // 帧时刻同样随会话清除——否则 15 秒内重连会拿上一次会话的时刻当本次的，
                // 新会话首帧还没到就先把上一次的数字当成实时读数显示出来。
                _lastFrameAtMillis.value = null
            }
            _observationHealth.value = ObservationHealth.IDLE
        }
    }

    override fun onTraffic(traffic: Traffic) {
        _traffic.value = traffic
        synchronized(rateTrendLock) {
            // 只读一次时钟：帧时刻与趋势样本时刻同属这一帧，各读一次会让两者
            // 相差一个不确定的小量，「同拍」的说法就不再是真的。
            val frameAtMillis = elapsedRealtimeMillis()
            _memoryTrend.value = _memoryTrend.value.appending(frameAtMillis, traffic.memory)
            _rateTrend.value = _rateTrend.value.appending(frameAtMillis, traffic.up, traffic.down)
            _lastFrameAtMillis.value = frameAtMillis
        }
    }

    override fun onGroups(groups: List<NodeGroup>) {
        _groups.value = groups
        _groupsGeneration.value += 1
    }

    // ENGINE 日志喂入单点：入唯一缓冲（ANSI SGR 剥离在 LogStore 内）。
    override fun onLog(line: LogLine) {
        logStore.append(LogSource.ENGINE, line.level, line.message)
    }

    override fun onLogs(lines: List<LogLine>) {
        logStore.appendBatch(LogSource.ENGINE, lines)
    }

    override fun onError(error: EngineError) {
        // 来源 = 引擎：运行期经观察通道推来的那一类。
        _failure.value = FailureDiagnostic(error, System.currentTimeMillis(), FailureSource.ENGINE)
    }

    // 健康度由通道层推来，本层只存不判——判据（阈值）在 core，触发在通道。
    override fun onObservationHealth(health: ObservationHealth) {
        val wasStalled = _observationHealth.value.stalled
        _observationHealth.value = health
        // IDLE = 会话或绑定重来。此刻手里的帧时刻属于**上一条**通道，
        // 留着它会让新通道首帧到达前的十几秒里继续显示上一条的读数。
        if (health == ObservationHealth.IDLE) _lastFrameAtMillis.value = null
        if (wasStalled == health.stalled) return
        // 断流与恢复各落一行 APP 源，日志页因此能解释 ENGINE 段为什么停了。
        logStore.append(
            LogSource.APP,
            if (health.stalled) LogLevel.WARN else LogLevel.INFO,
            if (health.stalled) "observation channel stalled" else "observation channel resumed",
        )
    }

    /**
     * 运行时读数是否已不可信（观察通道断流，或本次会话尚无帧）。
     *
     * 尚无帧时立即成立而不等 15 秒：此刻 traffic 里躺的是**上一次会话**的最后一帧
     * （停止沿只清两块趋势、不清 traffic 本身），等下去等于拿上次的数字冒充本次。
     */
    fun trafficStale(): Boolean =
        _observationHealth.value.stalled ||
            ObservationFreshness.isStale(_lastFrameAtMillis.value, elapsedRealtimeMillis())

    /** 距最近一帧的毫秒数；null = 本次会话尚无任何帧。 */
    fun observationElapsedMillis(): Long? =
        ObservationFreshness.elapsedMillis(_lastFrameAtMillis.value, elapsedRealtimeMillis())

    fun selectNode(tag: String) = monitor.selectNode(tag)

    fun urlTest(tag: String) = monitor.urlTest(tag)

    private companion object {
        val EMPTY_TRAFFIC = Traffic(
            up = 0, down = 0, upTotal = 0, downTotal = 0, memory = 0, connIn = 0, connOut = 0
        )
    }
}
