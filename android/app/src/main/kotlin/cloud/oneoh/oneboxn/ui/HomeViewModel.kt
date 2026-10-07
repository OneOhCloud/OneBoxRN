package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.core.DurationFormat
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.HeroAction
import cloud.oneoh.oneboxn.core.NodeSelection
import cloud.oneoh.oneboxn.core.TrafficFormat
import cloud.oneoh.oneboxn.ui.components.SummaryCardBody
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 主页真实状态：注入 AppActions，把动作层 StateFlow 投影为
// snapshot state（视图零改动消费）。连接真相 = OS VPN 状态；EngineStatus 仅细化过渡态；
// 失败诊断驱动失败态（持续到下次成功启动）；hasConfig 决定电源砖是连接还是导入。
class HomeViewModel(private val actions: AppActions) : ViewModel() {
    enum class HeroState { DISCONNECTED, CONNECTING, START_FAILED, CONNECTED, DISCONNECTING }

    // 本地操作在途（loading 的「本地操作进行中」分量）：置于点按，清于结局（连接态迁移/失败）或超时上限。
    internal enum class PendingOp { START, STOP }

    var connected by mutableStateOf(actions.connected.value)
        private set
    /** 启动失败诊断与其观察时刻（不可分对，见 vpn/FailureDiagnostic）。 */
    var failure by mutableStateOf(actions.failure.value)
        private set
    var traffic by mutableStateOf(actions.traffic.value)
        private set

    /** 观察通道断流时读数走占位而非陈旧数字（与运行统计页同一判据）。 */
    var stale by mutableStateOf(actions.trafficStale())
        private set

    val uploadRate: String get() = reading(TrafficFormat.rate(traffic.up))
    val downloadRate: String get() = reading(TrafficFormat.rate(traffic.down))

    /** 本次用量：引擎报的上下行累计之和，与速率同一个断流判据。 */
    val sessionUsage: String get() = reading(TrafficFormat.bytes(traffic.upTotal + traffic.downTotal))

    private fun reading(formatted: String): String = if (stale) StatsViewModel.PLACEHOLDER else formatted

    /** 本次会话连上的时刻（`SystemClock.elapsedRealtime` 口径）；不在会话里为 null。 */
    var sessionStartedAt by mutableStateOf(actions.sessionStartedAt.value)
        private set

    /** 出口选择组的平铺投影（组名不进呈现层）。 */
    var selection by mutableStateOf(NodeSelection.from(actions.groups.value))
        private set
    var latencyTesting by mutableStateOf(actions.latencyTesting.value)
        private set

    /** 有配置判定 = 激活 profile 的配置内容非空；只投影判定结果，本层不持有原文。 */
    var hasConfig by mutableStateOf(actions.activeConfigContent.value.isNotBlank())
        private set
    private var tunnelStateKnown by mutableStateOf(actions.tunnelStateKnown.value)

    private var engineStatus by mutableStateOf(actions.status.value)
    private var pending by mutableStateOf<PendingOp?>(null)
    private var pendingTimeout: Job? = null

    // 节点切换的乐观选中：Monitor.selectNode 契约无失败通道，展示以引擎 groups 推送为准。
    // 判据是推送计数而非选中值——切换失败时引擎推的是同一份快照、选中值不变（判定在 core NodeSelection）。
    private var optimisticNode by mutableStateOf<NodeSelection.Optimistic?>(null)
    private var groupsGeneration by mutableStateOf(actions.groupsGeneration.value)

    init {
        viewModelScope.launch {
            actions.connected.collect { now ->
                connected = now
            }
        }
        viewModelScope.launch {
            actions.status.collect { status ->
                engineStatus = status
                when (completedOperation(status)) {
                    CompletedOperation.START -> clearPending(PendingOp.START)
                    CompletedOperation.STOP -> clearPending(PendingOp.STOP)
                    CompletedOperation.NONE -> Unit
                }
            }
        }
        viewModelScope.launch {
            actions.failure.collect { diagnostic ->
                failure = diagnostic
                if (diagnostic != null) clearPending(PendingOp.START)
            }
        }
        viewModelScope.launch { actions.traffic.collect { traffic = it } }
        viewModelScope.launch { actions.sessionStartedAt.collect { sessionStartedAt = it } }
        // 会话卡读数与运行统计页同源同拍，断流判据也必须同一个——否则同一时刻两页
        // 一个显数字一个显占位，成了两份不一致的运行时指标来源。
        viewModelScope.launch { actions.observationHealth.collect { stale = actions.trafficStale() } }
        viewModelScope.launch { actions.lastFrameAtMillis.collect { stale = actions.trafficStale() } }
        viewModelScope.launch { actions.groups.collect { selection = NodeSelection.from(it) } }
        viewModelScope.launch { actions.groupsGeneration.collect { groupsGeneration = it } }
        viewModelScope.launch { actions.latencyTesting.collect { latencyTesting = it } }
        viewModelScope.launch { actions.activeConfigContent.collect { hasConfig = it.isNotBlank() } }
        viewModelScope.launch { actions.tunnelStateKnown.collect { tunnelStateKnown = it } }
    }

    val heroState: HeroState
        get() = if (!tunnelStateKnown) HeroState.CONNECTING else deriveHeroState(
            connected = connected,
            status = engineStatus,
            hasError = failure != null,
            startPending = pending == PendingOp.START,
            stopPending = pending == PendingOp.STOP,
        )

    /** loading 期间英雄键禁用。 */
    val heroLoading: Boolean
        get() = heroState == HeroState.CONNECTING || heroState == HeroState.DISCONNECTING

    /** 组位此刻放哪一张卡；`null` = 这一格空着（位置照留）。 */
    val group: HomeGroup?
        get() = deriveHomeGroup(heroState, hasConfig = hasConfig, hasNodes = selection.nodes.isNotEmpty())

    /** 会话卡的节点：出口选择组当前选中（乐观值优先，下一次分组推送即改用引擎真相）。 */
    val selectedNode: String
        get() = NodeSelection.selectedForDisplay(selection.selected, optimisticNode, groupsGeneration)

    /** 选中节点此刻的延迟读数；选中值暂时不在成员里（乐观选中未落地）时就是没有值。 */
    val selectedLatency: LatencyReading
        get() = latencyReadingOf(
            delayMs = selection.nodes.firstOrNull { it.tag == selectedNode }?.delayMs ?: 0,
            latencyTesting = latencyTesting,
        )

    /** 失败弹层配置指纹行（当前激活 profile 存储内容的指纹，不含内容本身）。 */
    val startConfigFingerprint: String? get() = actions.startConfigFingerprint

    /** 授权已过（授权前置在 Screen 完成）后启动；结局经 connected/失败诊断回流。 */
    fun connect() {
        beginPending(PendingOp.START, START_PENDING_CAP_MS)
        actions.connect()
    }

    /** 停止，上限 10s；结局经 connected 回流。 */
    fun disconnect() {
        beginPending(PendingOp.STOP, STOP_PENDING_CAP_MS)
        actions.disconnect()
    }

    /** 节点切换（乐观选中 + 引擎命令）。 */
    fun selectNode(tag: String) {
        optimisticNode = NodeSelection.Optimistic(tag, groupsGeneration)
        actions.selectNode(tag)
    }

    private fun beginPending(op: PendingOp, capMs: Long) {
        pending = op
        pendingTimeout?.cancel()
        pendingTimeout = viewModelScope.launch {
            delay(capMs)
            pending = null
        }
    }

    private fun clearPending(op: PendingOp) {
        if (pending == op) {
            pending = null
            pendingTimeout?.cancel()
        }
    }

    private companion object {
        // 启动 / 停止的操作上限：fire-and-forget 结局由服务广播驱动，此处只兜底解除本地 loading。
        const val START_PENDING_CAP_MS = 20_000L
        const val STOP_PENDING_CAP_MS = 10_000L
    }
}

// heroState 推导纯函数（单测锁定）：连接真相 = OS 状态；过渡态 = 本地操作在途 ∨ 引擎 STARTING/STOPPING；
// 失败态 = 未连接且失败诊断非空（持续到下次成功启动被清除）。
internal fun deriveHeroState(
    connected: Boolean,
    status: EngineStatus,
    hasError: Boolean,
    startPending: Boolean,
    stopPending: Boolean,
): HomeViewModel.HeroState = when {
    stopPending || status == EngineStatus.STOPPING -> HomeViewModel.HeroState.DISCONNECTING
    connected -> HomeViewModel.HeroState.CONNECTED
    startPending || status == EngineStatus.STARTING -> HomeViewModel.HeroState.CONNECTING
    hasError -> HomeViewModel.HeroState.START_FAILED
    else -> HomeViewModel.HeroState.DISCONNECTED
}

/**
 * 电源砖此刻按下去会做什么：隧道在跑或正要跑 → 断开，其余 → 连接。
 * 导入结论页的主按钮读它（core `ImportConclusion.of`），与砖同一语义，不另判一次连没连着。
 */
internal fun deriveHeroAction(state: HomeViewModel.HeroState): HeroAction = when (state) {
    HomeViewModel.HeroState.CONNECTED, HomeViewModel.HeroState.CONNECTING -> HeroAction.DISCONNECT
    HomeViewModel.HeroState.DISCONNECTED, HomeViewModel.HeroState.START_FAILED, HomeViewModel.HeroState.DISCONNECTING ->
        HeroAction.CONNECT
}

internal enum class CompletedOperation { NONE, START, STOP }

internal fun completedOperation(status: EngineStatus): CompletedOperation = when (status) {
    EngineStatus.STARTED -> CompletedOperation.START
    EngineStatus.STOPPED -> CompletedOperation.STOP
    EngineStatus.STARTING, EngineStatus.STOPPING -> CompletedOperation.NONE
}

/** 首页组位此刻放哪一张卡。三张同宽同高叠放，组位高恒定，电源砖在各态之间不动。 */
enum class HomeGroup {
    /** 未连接：当前配置的站标、名称、到期与流量；两份以上时卡身点开切换配置。 */
    PROFILE,

    /** 已连接：节点、网速、本次时长与用量；节点行点开换节点。 */
    SESSION,

    /** 启动失败：点开看诊断。 */
    FAILURE_DETAILS,
}

/**
 * 组位的归属；`null` = 这一格空着。
 *
 * 没有配置时砖本身就是导入入口，组位里没有当前配置可说。
 * 连接中 / 切换中没有哪一张成立；已连接而出口组还没有成员时，节点行点开的弹层里不会有东西。
 */
internal fun deriveHomeGroup(state: HomeViewModel.HeroState, hasConfig: Boolean, hasNodes: Boolean): HomeGroup? {
    if (!hasConfig) return null
    return when (state) {
        HomeViewModel.HeroState.DISCONNECTED -> HomeGroup.PROFILE
        HomeViewModel.HeroState.CONNECTING, HomeViewModel.HeroState.DISCONNECTING -> null
        HomeViewModel.HeroState.CONNECTED -> if (hasNodes) HomeGroup.SESSION else null
        HomeViewModel.HeroState.START_FAILED -> HomeGroup.FAILURE_DETAILS
    }
}

/**
 * 首页配置卡的卡身做什么：两份以上配置才点开切换；只有一份时弹层里只有它自己，卡身不可点、不画「›」。
 */
internal fun profileCardBody(profileCount: Int, onSwitch: () -> Unit): SummaryCardBody =
    if (profileCount >= MIN_PROFILES_TO_SWITCH) SummaryCardBody.SwitchProfile(onSwitch) else SummaryCardBody.Static

private const val MIN_PROFILES_TO_SWITCH = 2

/** 本次时长的读数形态。「天」要随语言变，拼在呈现层；这里只给结构与纯数字串。 */
sealed interface SessionDuration {
    /** 不在会话里：占位。 */
    data object Absent : SessionDuration

    /** 不满一天：钟面 `01:23:45`。 */
    data class Clock(val text: String) : SessionDuration

    /** 满一天后天数单说、钟面只留到分：秒位在那个量级上已没有读的意义。 */
    data class Days(val days: String, val hoursMinutes: String) : SessionDuration
}

/** [startedAtMillis] 与 [nowMillis] 同一时钟（`SystemClock.elapsedRealtime`）；不足一秒的零头舍去。 */
internal fun sessionDurationOf(startedAtMillis: Long?, nowMillis: Long): SessionDuration {
    if (startedAtMillis == null) return SessionDuration.Absent
    val seconds = (nowMillis - startedAtMillis) / MILLIS_PER_SECOND
    val parts = DurationFormat.parts(seconds)
    if (parts.days == 0L) return SessionDuration.Clock(DurationFormat.clock(seconds))
    return SessionDuration.Days(days = parts.days.toString(), hoursMinutes = DurationFormat.hoursMinutes(parts))
}

internal const val MILLIS_PER_SECOND = 1_000L
