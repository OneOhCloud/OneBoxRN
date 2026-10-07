package cloud.oneoh.oneboxn.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import cloud.oneoh.oneboxn.CompiledStart
import cloud.oneoh.oneboxn.bridge.StartDiagnostic
import cloud.oneoh.oneboxn.LogSource
import cloud.oneoh.oneboxn.LogStore
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.FailureSource
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.MergeError
import cloud.oneoh.oneboxn.core.TunnelControl
import cloud.oneoh.oneboxn.core.describe
import cloud.oneoh.oneboxn.core.reloadDiagnosis
import cloud.oneoh.oneboxn.tunnel.TunnelService
import cloud.oneoh.oneboxn.tunnel.TunnelConfigHandoff
import cloud.oneoh.oneboxn.tunnel.TunnelSignals
import java.io.File
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** 启动失败的平台异常：message 承载引擎诊断，经 core 流水线在边界类型化为 StartFailed。 */
class TunnelStartException(message: String) : Exception(message)

private data class PreparedStartConfig(
    val token: String,
    // 与本次编译同一次快照捕获的记账归属，随启动 Intent 交给 :tun。
    val profileId: String,
)

// 启停控制 + 连接真相 + core TunnelControl 端口实现 + 启动期合并装配。
// 连接生命周期以 OS 服务状态为权威：:tun 服务从其真实生命周期广播
// TUNNEL_STATE，本类据此驱动 connected / 失败诊断与 suspend 启停的结局判定。
class TunnelController(
    private val context: Context,
    private val compileConfig: suspend () -> CompiledStart,
    private val logStore: LogStore,
    // 依赖链：suspend start() 在合并装配前 await 一次探测（唯一入口在 AppActions.refreshDirectDns）。
    private val refreshDirectDns: suspend () -> Unit,
    // 失败诊断第 1 级：隧道进程写下的真因，经中立契约 `Monitor.lastError()` 取（装配注入，
    // 故本类不识内核、也不自己碰那个文件）。合成失败诊断时读一次，读的是当下的盘面。
    private val tunnelDiagnosis: () -> EngineError?,
) : TunnelControl {
    private val processExitReader = SystemProcessExitReader(context)
    private val tunnelProcessName = "${context.packageName}:tun"

    private val _status = MutableStateFlow(EngineStatus.STOPPED)
    val status: StateFlow<EngineStatus> = _status.asStateFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _stateKnown = MutableStateFlow(false)
    val stateKnown: StateFlow<Boolean> = _stateKnown.asStateFlow()

    // 本次会话连上的时刻（`SystemClock.elapsedRealtime` 口径），与 connected 同进同出：不在会话里为 null。
    // 取自 :tun 在 STARTED 那一沿记下的值，而不是本进程收到广播的时刻——UI 进程重建后回放出来的
    // 仍是那一次连上的时刻，热重载也不会把它刷新。
    private val _sessionStartedAt = MutableStateFlow<Long?>(null)
    val sessionStartedAt: StateFlow<Long?> = _sessionStartedAt.asStateFlow()

    // 启动失败诊断的广播通道：失败置值、下次成功启动清空。
    // 诊断与观察时刻同为一个值——拆成两条流会让「错误已到、时刻未到」成为可观察中间态
    // （见 FailureDiagnostic）。本通道的诊断恒来自在线观察，故时刻恒非空。
    private val _failure = MutableStateFlow<FailureDiagnostic?>(null)
    val failure: StateFlow<FailureDiagnostic?> = _failure.asStateFlow()

    // suspend start() 的结局信号（事件而非状态：同一错误重现也必须再次触发判定）。
    private data class StateEvent(val status: EngineStatus, val error: EngineError?)

    private val stateEvents = MutableSharedFlow<StateEvent>(extraBufferCapacity = 16)

    /** 热重载结局：与请求 id 配对，迟到的旧结局不得判定新一次重载。 */
    private data class ReloadOutcome(val reloadId: Long, val error: EngineError?)

    private val reloadOutcomes = MutableSharedFlow<ReloadOutcome>(extraBufferCapacity = 8)
    private val reloadIds = AtomicLong()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val queryIds = AtomicLong()
    private val configHandoff = TunnelConfigHandoff(File(context.cacheDir, CONFIG_HANDOFF_DIRECTORY))
    private val preparedStartLock = Any()
    private var preparedStartConfig: PreparedStartConfig? = null
    @Volatile private var activeQueryId = 0L

    private val reloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val reloadId = intent.getLongExtra(TunnelSignals.EXTRA_RELOAD_ID, 0L)
            val token = intent.getStringExtra(TunnelSignals.EXTRA_ERROR_TOKEN)
            val error = token?.let { EngineError(it, intent.getStringExtra(TunnelSignals.EXTRA_ERROR_DETAIL)) }
            reloadOutcomes.tryEmit(ReloadOutcome(reloadId, error))
        }
    }

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            // 相位来自本仓自己的 `:tun` 广播（NOT_EXPORTED + setPackage，别人发不进来）：
            // 缺失或映射不到枚举都是跨进程装配 bug（枚举穷尽破坏）——崩溃暴露。静默 return 会把随行的
            // ERROR_TOKEN/DETAIL 一并丢掉，UI 永久停在上一相位而无人知道为什么。
            val phase = intent.getStringExtra(TunnelSignals.EXTRA_PHASE) ?: error("missing tunnel phase extra")
            val status = EngineStatus.valueOf(phase)
            val queryId = intent
                .takeIf { it.hasExtra(TunnelSignals.EXTRA_QUERY_ID) }
                ?.getLongExtra(TunnelSignals.EXTRA_QUERY_ID, 0L)
            if (queryId != null && queryId != activeQueryId) return
            activeQueryId = 0L
            _stateKnown.value = true
            val changed = _status.value != status
            publishStatus(status, sessionStartedAt = if (status == EngineStatus.STARTED) sessionStartOf(intent) else null)
            val token = intent.getStringExtra(TunnelSignals.EXTRA_ERROR_TOKEN)
            val error = token?.let { EngineError(it, intent.getStringExtra(TunnelSignals.EXTRA_ERROR_DETAIL)) }
            // 来源由**登记方**（:tun）随诊断发过来，本层只读不猜；extra 缺席或认不出 ⇒ null ⇒ 占位「—」。
            val source = FailureSource.fromToken(intent.getStringExtra(TunnelSignals.EXTRA_ERROR_SOURCE))
            when {
                error != null -> _failure.value = FailureDiagnostic(error, System.currentTimeMillis(), source)
                status == EngineStatus.STARTED -> _failure.value = null
            }
            if (!changed && error == null) return
            // APP 日志喂入（隧道控制与服务事件）：服务生命周期事件与失败诊断入唯一缓冲。
            logStore.append(LogSource.APP, LogLevel.INFO, "tunnel ${status.name.lowercase()}")
            error?.let(::logFailure)
            stateEvents.tryEmit(StateEvent(status, error))
        }
    }

    init {
        ContextCompat.registerReceiver(
            context,
            stateReceiver,
            IntentFilter(TunnelSignals.ACTION_STATE),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        ContextCompat.registerReceiver(
            context,
            reloadReceiver,
            IntentFilter(TunnelSignals.ACTION_RELOAD_RESULT),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        queryState(StateQueryKnowledge.UNKNOWN)
    }

    /** 前台恢复时重新核对 :tun 真相；无服务响应会在有界等待后回落 STOPPED。 */
    fun refreshState() {
        if (!_stateKnown.value && activeQueryId != 0L) return
        queryState(StateQueryKnowledge.KNOWN)
    }

    /** 配置变更需要区分 STARTING 与真实 STOPPED；首次进程重建时先等待显式回放。 */
    suspend fun statusForConfigurationChange(): EngineStatus {
        val current = awaitAuthoritativeStatus()
        if (current != EngineStatus.STARTING) return current
        return withTimeoutOrNull(START_WAIT_MS) {
            status.first { it != EngineStatus.STARTING }
        } ?: status.value
    }

    /**
     * 单一真相：启动路径与配置查看页 Merged 视图共用本函数，全仓不存在第二处合并调用。
     * `MergeError`（导入内容不可合并的领域错误）原样上抛给查看页呈现；启动路径在 launchTunnel 内
     * 把它映射为启动失败诊断。模板缺失/结构非法是崩溃类，不在任何一层捕获。
     */
    suspend fun mergedConfig(): String = compileConfig().config

    /**
     * 配置变更走完整重启时专用：**停到 OS 确认断开之后**按启动链路探测并编译最新配置，写入一次性
     * handoff（停止前装配落在「隧道未停不发包」的窗口里，永远拿不到新鲜的直连值）。
     * 普通启动仍在 launchTunnel 内装配；这里准备的令牌只被下一次 launchTunnel 消费一次。
     */
    suspend fun prepareNextStartConfig() {
        replacePreparedStart(assembleStartConfig())
    }

    /**
     * 热重载：探测 → 编译 → 交给 :tun 就地换引擎，**不停止系统 VPN 会话**。
     *
     * 启动前探测同样适用：重载也要重新装配一份合并配置，少这一跳就会沿用上一次的直连 DNS 胜者。
     * 失败或超时抛 `TunnelStartException`；引擎侧失败的诊断由 :tun 的 `fail()` 经阶段广播落
     * `lastError`，本函数不重复登记，只有超时这条没有广播的路径由此处补登。
     */
    suspend fun reload() {
        val prepared = assembleStartConfig()
        val reloadId = reloadIds.incrementAndGet()
        // 系统退出清单是历史清单，取本次发起时刻作下界（失败诊断第 3 级的 Android 钉法）。
        val attemptStartedAtMillis = System.currentTimeMillis()
        val outcome = withTimeoutOrNull(START_WAIT_MS) {
            reloadOutcomes
                .onSubscription { sendReloadRequest(reloadId, prepared) }
                .first { it.reloadId == reloadId }
        } ?: run {
            withContext(Dispatchers.IO) { configHandoff.discard(prepared.token) }
            // 超时只说明结局广播没回来，此刻 `:tun` 的 fail() 多半已把真因
            // 写进启动诊断文件。先按失败诊断阶梯合成再登记——直接登记传输层症状的话，按诊断的
            // 读取序它恒赢，真因就永远浮不上来。
            val timedOut = reloadDiagnosis(
                transportDetail = withSystemExitDetail(
                    "engine reload timeout after ${START_WAIT_MS / 1000}s",
                    attemptStartedAtMillis,
                ),
                tunnelDiagnosis = withContext(Dispatchers.IO) { tunnelDiagnosis() },
            )
            rejectStart(timedOut.error, timedOut.source)
            requestStop()
            throw TunnelStartException(listOfNotNull(timedOut.error.token, timedOut.error.detail).joinToString(": "))
        }
        outcome.error?.let { failed ->
            throw TunnelStartException(listOfNotNull(failed.token, failed.detail).joinToString(": "))
        }
        logStore.append(LogSource.APP, LogLevel.INFO, "tunnel reloaded")
    }

    private fun sendReloadRequest(reloadId: Long, prepared: PreparedStartConfig) {
        logStore.append(LogSource.APP, LogLevel.INFO, "tunnel reload requested")
        context.sendBroadcast(
            Intent(TunnelSignals.ACTION_RELOAD)
                .setPackage(context.packageName)
                .putExtra(TunnelSignals.EXTRA_RELOAD_ID, reloadId)
                .putExtra(TunnelSignals.EXTRA_CONFIG_TOKEN, prepared.token)
                .putExtra(TunnelSignals.EXTRA_PROFILE_ID, prepared.profileId),
        )
    }

    /** 探测 → 编译 → 存一次性 handoff。重载与「重启前预备」共用这一条，不存在第二份装配。 */
    private suspend fun assembleStartConfig(): PreparedStartConfig {
        refreshDirectDns()
        return compileStartConfig()
            ?: rejectPreparedStart(failure.value)
    }

    fun clearPreparedStartConfig() {
        val prepared = synchronized(preparedStartLock) {
            val current = preparedStartConfig
            preparedStartConfig = null
            current
        }
        prepared?.let { withDiscardedPreparedToken(it) }
    }

    /**
     * 用户主动断开时，把**这一段**留下的失败诊断清干净 ——
     * App 侧的本地登记（广播通道）与隧道进程写在应用私有目录里的那份文件**都要清**。
     *
     * 不放进 `requestStop()`：那个函数也被失败收口与超时沿调用，而那两处正需要诊断活着
     * 给失败弹层取真因——两种停止在代码里长得一样，区别只在谁发起。
     * 清不掉不静默：`StartDiagnostic.clear` 自己 `Log.e`。
     */
    fun clearFailureDiagnostics() {
        _failure.value = null
        StartDiagnostic.clear(context)
    }

    /** 请求停止（fire-and-forget）；OS 确认经 TUNNEL_STATE 广播回落到 connected。 */
    fun requestStop() {
        logStore.append(LogSource.APP, LogLevel.INFO, "tunnel stop requested")
        context.sendBroadcast(Intent(TunnelSignals.ACTION_STOP).setPackage(context.packageName))
    }

    // —— core TunnelControl 端口 ——

    /**
     * 停到 OS 确认断开，上限 10s；未运行零等待；超时不抛，调用方继续推进。
     * 等的是 STOPPED 结局事件而非 connected 翻 false：connected 在 STOPPING 广播即翻 false，
     * 彼时服务仍在收尾，随后发起的 start 会被 onStartCommand 的相位守卫丢弃，重启就此卡死。
     */
    override suspend fun stop() {
        val current = awaitAuthoritativeStatus()
        if (current == EngineStatus.STOPPED) return
        if (status.value != EngineStatus.STOPPING) requestStop()
        withTimeoutOrNull(STOP_WAIT_MS) {
            status.first(::isStoppedTunnelStatus)
        }
    }

    /**
     * 启动并等 OS 确认连接，上限 20s；失败或超时抛 TunnelStartException（引擎诊断入 message）。
     * 配置在 launchTunnel 内启动期装配合并。
     */
    override suspend fun start() {
        if (settleBeforeStart() == StartPreparation.ALREADY_STARTED) return
        // probe（≤500ms）→ merge → start 严格串行（覆盖配置变更重启与导入 apply 两条启动路径）。
        //
        // 已有预装配配置时不探：重启路径已经在「确认停止之后」经 prepareNextStartConfig 探过一次
        // 并用那个胜者编好了配置，而下面的 launchTunnel 正是要消费那一份 —— 此处再探一次进不了
        // 那份配置，只会把内存态改成第二轮的胜者，让展示值与实际生效的配置分叉（已连接时展示值
        // 须恒等于启动配置所用值）。分叉持续整个连接会话：连上之后探测入口就拒发包，错的值一直钉到断开。
        //
        // 窥视与消费之间的竞态：所有启动路径都在 AppActions 的 restartGuard 下串行
        // （connect() 与 applyConfigurationChange 各持一次）；唯一不持锁又会清暂存的是
        // disconnect()，而那一支落到 compileStartConfig() 用的仍是几秒前刚探出的同一个胜者，
        // 且 startAndHonorConnectionIntent 的 finally 会把这次启动收口 —— 不产生坏结果。
        //
        // 这段论证没有单测守卫（TunnelController 吃 Context / VpnService / 广播，探测要发真 DNS 包），
        // 改这一行之前先读完它。
        if (!hasPreparedStartConfig()) refreshDirectDns()
        // 探测期间其他请求可能已完成启停；再次核对，避免重复启动后等待一个已去重的事件。
        if (settleBeforeStart() == StartPreparation.ALREADY_STARTED) return
        // 系统退出记录是历史清单，取本次发起时刻作下界，旧崩溃不得冒充本次原因。
        val attemptStartedAtMillis = System.currentTimeMillis()
        // 先订阅再发起，结局广播不丢失；权限缺失/合并失败作为合成结局事件进入同一判定。
        val completionPolicy = StartCompletionPolicy()
        val outcome = withTimeoutOrNull(START_WAIT_MS) {
            stateEvents
                .onSubscription {
                    launchTunnel()?.let { failed -> emit(StateEvent(EngineStatus.STOPPED, failed)) }
                }
                .first { completionPolicy.isTerminal(it.status, TerminalCause.from(it.error)) }
        } ?: run {
            // 预算到点**只结束等待，不结束会话** —— 先判本次尝试期间会话有没有离开过断开态。
            if (completionPolicy.observedStarting) {
                // **已在推进** ⇒ 不判负、不拆会话：宿主只是不再等了，连上即翻连接态；
                // 这次尝试的结局由**会话自己**发布（终止沿），不由等待者发布。
                // 不在这里 `requestStop()` + 抛：掐掉会话救不了任何一次失败，只会掐掉一条正在好起来的会话。
                return
            }
            // **从未离开断开态** ⇒ 系统压根没把这次尝试推进到连接中，这是确定的失败。
            // 详情如实说这一点，不只报「启动超时」；而超时这个事实不得被覆盖
            // ⇒ 先说超时，其余（本条的成因 + 系统退出清单）一律作为附注拼在其后。
            requestStop()
            throw TunnelStartException(
                withSystemExitDetail(
                    "engine start timeout after ${START_WAIT_MS / 1000}s" +
                        " — system never moved this attempt out of disconnected",
                    attemptStartedAtMillis,
                ),
            )
        }
        outcome.error?.let { failed ->
            throw TunnelStartException(listOfNotNull(failed.token, failed.detail).joinToString(": "))
        }
        if (outcome.status != EngineStatus.STARTED) {
            throw TunnelStartException(
                withSystemExitDetail("engine stopped before start completed", attemptStartedAtMillis),
            )
        }
    }

    /**
     * 失败诊断第 3 级：隧道进程一句话没留下就没了时，把系统记下的退出原因补进详情。
     *
     * 不覆盖原文案而是接在其后：原文案说明「在哪一步失败」，系统原因说明「为什么」，两者都要。
     */
    private suspend fun withSystemExitDetail(message: String, sinceMillis: Long): String {
        val exit = withContext(Dispatchers.IO) {
            TunnelExitDiagnostic.describe(processExitReader.records(), tunnelProcessName, sinceMillis)
        }
        return listOfNotNull(message, exit).joinToString(" — ")
    }

    private suspend fun settleBeforeStart(): StartPreparation = when (awaitAuthoritativeStatus()) {
        EngineStatus.STARTED -> StartPreparation.ALREADY_STARTED
        EngineStatus.STARTING -> {
            awaitExistingStart()
            StartPreparation.ALREADY_STARTED
        }
        EngineStatus.STOPPING -> {
            awaitStoppedBeforeStart()
            StartPreparation.START_NEEDED
        }
        EngineStatus.STOPPED -> StartPreparation.START_NEEDED
    }

    private suspend fun awaitExistingStart() {
        val waitStartedAtMillis = System.currentTimeMillis()
        val terminal = withTimeoutOrNull(START_WAIT_MS) {
            status.first { it != EngineStatus.STARTING }
        } ?: run {
            requestStop()
            throw TunnelStartException(
                withSystemExitDetail("engine start timeout after ${START_WAIT_MS / 1000}s", waitStartedAtMillis),
            )
        }
        if (terminal == EngineStatus.STARTED) return
        val diagnostic = failure.value?.error
        val message = diagnostic?.let { listOfNotNull(it.token, it.detail).joinToString(": ") }
            ?: withSystemExitDetail("engine stopped before start completed", waitStartedAtMillis)
        throw TunnelStartException(message)
    }

    private suspend fun awaitStoppedBeforeStart() {
        val stopped = withTimeoutOrNull(STOP_WAIT_MS) {
            status.first(::isStoppedTunnelStatus)
        }
        if (stopped == null) {
            throw TunnelStartException("engine stop timeout after ${STOP_WAIT_MS / 1000}s")
        }
    }

    // 两条启动路径共用的实现：权限缺失或合并失败返回错误并落失败诊断，不触发服务。
    private suspend fun launchTunnel(): EngineError? {
        logStore.append(LogSource.APP, LogLevel.INFO, "tunnel start requested")
        if (VpnService.prepare(context) != null) {
            // 来源 = App：缺授权是本进程自己判出来的（引擎没被启动过）。
            return rejectStart(
                EngineError("VPN_PERMISSION_REQUIRED", "call VpnService.prepare from an Activity"),
                FailureSource.APP,
            )
        }
        val startConfig = preparedStartConfig() ?: compileStartConfig() ?: return failure.value?.error
        val intent = Intent(context, TunnelService::class.java)
            .putExtra(TunnelSignals.EXTRA_CONFIG_TOKEN, startConfig.token)
            .putExtra(TunnelSignals.EXTRA_PROFILE_ID, startConfig.profileId)
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (failed: Exception) {
            withContext(Dispatchers.IO) { configHandoff.discard(startConfig.token) }
            // 来源 = 系统：**系统拒绝拉起隧道进程**（查签名 / 配置 / 权限那一类）。
            // 它不是 App 的判定，也轮不到引擎说话。
            return rejectStart(EngineError("START_FAILED_GENERIC", describe(failed)), FailureSource.SYSTEM)
        }
        return null
    }

    private suspend fun compileStartConfig(): PreparedStartConfig? {
        // 启动期装配合并：MergeError 是领域错误 → 映射为启动失败诊断（不吞）；
        // 模板缺失/结构非法是崩溃类，任其穿透。
        val compiled = try {
            withTimeoutOrNull(CONFIG_COMPILE_WAIT_MS) { compileConfig() }
                ?: run {
                    rejectStart(
                        EngineError(
                            "MERGE_FAILED",
                            "config compile timeout after ${CONFIG_COMPILE_WAIT_MS / 1000}s",
                        ),
                        // 来源 = App：合并预算到点，是本进程自己的判定。
                        FailureSource.APP,
                    )
                    return null
                }
        } catch (rejected: MergeError) {
            // 来源 = App：合并失败是本进程自己的判定。
            rejectStart(EngineError("MERGE_FAILED", rejected.message), FailureSource.APP)
            return null
        }
        val token = try {
            withContext(Dispatchers.IO) { configHandoff.store(compiled.config) }
        } catch (failed: Exception) {
            // 来源 = App：交接件落盘是本进程自己的活。
            rejectStart(EngineError("START_FAILED_GENERIC", describe(failed)), FailureSource.APP)
            return null
        }
        return PreparedStartConfig(token, compiled.profileId)
    }

    /**
     * 装配失败的收口：`compileStartConfig()` 走不通时，它**已经登记过**一份带来源的诊断
     * （合并失败 / 落盘失败），此处照原样再登记一次即可。
     *
     * 整份沿用，不「错误取已登记那份、来源另挑一个」：已登记那份的来源可能是 null
     * （没记下），而 `registered?.source ?: APP` 会给一个来源不明的错误编一个 App 出来
     * （详见 `FailureSource` 的类注释）。一份都没有时这句话才是本进程现编的 ⇒ 来源 `APP`。
     */
    private fun rejectPreparedStart(registered: FailureDiagnostic?): Nothing {
        val error = registered?.error ?: EngineError("START_FAILED_GENERIC", "config assembly failed")
        rejectStart(error, if (registered != null) registered.source else FailureSource.APP)
        throw TunnelStartException(listOfNotNull(error.token, error.detail).joinToString(": "))
    }

    /** 只窥视不取走（「已装配就不再探」判据）；取走那一次在 [preparedStartConfig]。 */
    private fun hasPreparedStartConfig(): Boolean = synchronized(preparedStartLock) {
        preparedStartConfig != null
    }

    private fun preparedStartConfig(): PreparedStartConfig? = synchronized(preparedStartLock) {
        val prepared = preparedStartConfig
        preparedStartConfig = null
        prepared
    }

    private fun replacePreparedStart(prepared: PreparedStartConfig) {
        val stale = synchronized(preparedStartLock) {
            val current = preparedStartConfig
            preparedStartConfig = prepared
            current
        }
        stale?.let { withDiscardedPreparedToken(it) }
    }

    private fun withDiscardedPreparedToken(prepared: PreparedStartConfig) {
        runCatching { configHandoff.discard(prepared.token) }
    }

    /**
     * [source] **可空但无默认值**：可空是因为「没记下来源」是一个真实且合法的状态（占位「—」）；
     * 无默认值是因为有默认值会让「忘了给」与「有意不给」在源码里长得一模一样。
     */
    private fun rejectStart(error: EngineError, source: FailureSource?): EngineError {
        _failure.value = FailureDiagnostic(error, System.currentTimeMillis(), source)
        logFailure(error)
        return error
    }

    // 失败诊断的 APP 源错误行（广播通道与合成通道共用格式；失败诊断 error 级）。
    private fun logFailure(error: EngineError) {
        logStore.append(LogSource.APP, LogLevel.ERROR, listOfNotNull(error.token, error.detail).joinToString(": "))
    }

    // 起点先于连接态落值：订阅方看到 connected 翻真的那一拍，起点已经在了，时长不会先闪一下占位。
    private fun publishStatus(status: EngineStatus, sessionStartedAt: Long?) {
        _sessionStartedAt.value = sessionStartedAt
        _status.value = status
        _connected.value = status == EngineStatus.STARTED
    }

    // STARTED 缺会话起点是跨进程装配 bug，与缺相位同一处置：崩溃暴露。
    private fun sessionStartOf(intent: Intent): Long {
        check(intent.hasExtra(TunnelSignals.EXTRA_SESSION_STARTED_AT)) { "missing session start extra" }
        return intent.getLongExtra(TunnelSignals.EXTRA_SESSION_STARTED_AT, 0L)
    }

    private fun queryState(knowledge: StateQueryKnowledge) {
        val queryId = queryIds.incrementAndGet()
        activeQueryId = queryId
        if (knowledge == StateQueryKnowledge.UNKNOWN) _stateKnown.value = false
        context.sendBroadcast(
            TunnelSignals.queryState(context.packageName).putExtra(TunnelSignals.EXTRA_QUERY_ID, queryId),
        )
        mainHandler.postDelayed({
            if (activeQueryId != queryId) return@postDelayed
            val fallback = statusAfterStateQueryTimeout()
            val changed = _status.value != fallback
            publishStatus(fallback, sessionStartedAt = null)
            _stateKnown.value = true
            if (changed) stateEvents.tryEmit(StateEvent(fallback, null))
        }, STATE_QUERY_WAIT_MS)
    }

    private suspend fun awaitAuthoritativeStatus(): EngineStatus {
        if (!_stateKnown.value) {
            withTimeoutOrNull(STATE_QUERY_WAIT_MS + STATE_QUERY_GRACE_MS) {
                stateKnown.first { it }
            }
        }
        return status.value
    }

    private companion object {
        enum class StartPreparation { START_NEEDED, ALREADY_STARTED }
        enum class StateQueryKnowledge { UNKNOWN, KNOWN }

        const val STOP_WAIT_MS = 10_000L
        const val START_WAIT_MS = 20_000L
        const val CONFIG_COMPILE_WAIT_MS = 5_000L
        const val STATE_QUERY_WAIT_MS = 500L
        const val STATE_QUERY_GRACE_MS = 250L
        const val CONFIG_HANDOFF_DIRECTORY = "tunnel-start-config"
    }
}

/**
 * 状态查询超时后**按「已停止」处置**。
 *
 * 「不知道」这个条件本端是建模了的（`StateQueryKnowledge` / `_stateKnown`，带
 * `STATE_QUERY_WAIT_MS` + `STATE_QUERY_GRACE_MS` 的等待），而它在这里被折叠成一个确定态
 * ——`EngineStatus` 与上层的 `HeroState` 都没有「未知」这一档，于是 UI 永远收不到它。
 *
 * 折叠朝「不声称保护」的方向：误报「未连接」而其实在跑，用户只会更小心；误报「已连接」
 * 而其实没跑，用户会放心地发出流量。少报保护是保守的，多报保护是危险的。
 * 两端方向一致（Apple 在契约边界就把 `.invalid` 与 `.disconnected` 并了案）。
 */
internal fun statusAfterStateQueryTimeout(): EngineStatus = EngineStatus.STOPPED

internal fun isStoppedTunnelStatus(status: EngineStatus): Boolean = status == EngineStatus.STOPPED

/** 启动等待忽略订阅建立时的旧 STOPPED，只接受真实 STARTING 之后的停止结局。 */
internal class StartCompletionPolicy {
    /**
     * 本次尝试期间会话**有没有离开过断开态**。
     *
     * `isTerminal` 为了判「STOPPED 算不算终局」本来就在记它，超时沿只是把同一个事实读出来，
     * 不需要新通道。
     */
    var observedStarting = false
        private set

    fun isTerminal(status: EngineStatus, cause: TerminalCause): Boolean {
        if (cause == TerminalCause.ERROR) return true
        return when (status) {
            EngineStatus.STARTING -> {
                observedStarting = true
                false
            }
            EngineStatus.STARTED -> true
            EngineStatus.STOPPING -> false
            EngineStatus.STOPPED -> observedStarting
        }
    }
}

internal enum class TerminalCause {
    ERROR,
    NONE;

    companion object {
        fun from(error: EngineError?): TerminalCause = if (error == null) NONE else ERROR
    }
}
