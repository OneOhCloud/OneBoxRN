package cloud.oneoh.oneboxn

import cloud.oneoh.oneboxn.core.AcceleratedConfigFetcher
import cloud.oneoh.oneboxn.core.ConfigFetcher
import cloud.oneoh.oneboxn.core.ConfigRefresh
import cloud.oneoh.oneboxn.core.DomainVerify
import cloud.oneoh.oneboxn.core.FetchAttempt
import cloud.oneoh.oneboxn.core.FetchRoute
import cloud.oneoh.oneboxn.core.RefreshRecord
import cloud.oneoh.oneboxn.core.RefreshRecordOutcome
import cloud.oneoh.oneboxn.core.RefreshRecordStore
import cloud.oneoh.oneboxn.core.RefreshTrigger
import cloud.oneoh.oneboxn.core.ConfigChange
import cloud.oneoh.oneboxn.core.ConfigChangeDisposition
import cloud.oneoh.oneboxn.core.ConfigFingerprint
import cloud.oneoh.oneboxn.core.directDnsProbeAllowed
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.ImportFlow
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.ImportPhase
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.MemoryTrend
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.ObservationHealth
import cloud.oneoh.oneboxn.core.NodeSelection
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.ProfileStore
import cloud.oneoh.oneboxn.core.RefreshOutcome
import cloud.oneoh.oneboxn.core.Region
import cloud.oneoh.oneboxn.core.RenameOutcome
import cloud.oneoh.oneboxn.core.RoutingMode
import cloud.oneoh.oneboxn.core.Rule
import cloud.oneoh.oneboxn.core.TunnelControl
import cloud.oneoh.oneboxn.core.configChangeDisposition
import cloud.oneoh.oneboxn.core.sessionPhase
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.core.TrafficRateTrend
import cloud.oneoh.oneboxn.core.UrlInfo
import cloud.oneoh.oneboxn.net.raceDnsProbe
import cloud.oneoh.oneboxn.usage.UsageReader
import cloud.oneoh.oneboxn.usage.UsageRecordSnapshot
import cloud.oneoh.oneboxn.vpn.FailureDiagnostic
import cloud.oneoh.oneboxn.vpn.TunnelClient
import cloud.oneoh.oneboxn.vpn.TunnelController
import cloud.oneoh.oneboxn.vpn.TunnelStartException
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// 导入页动作契约：ViewModel 只依赖启动流水线所需的窄面，不感知应用级动作集合。
interface ImportActions {
    fun requiresVpnConsent(payload: ImportPayload): Boolean

    suspend fun importProfile(payload: ImportPayload, onPhase: (ImportPhase) -> Unit): ImportPhase
}

// 配置页动作契约：ProfilesViewModel 只依赖此窄面。
// 生产唯一实现 = AppActions；JVM 单测以假实现打桩、内部仍驱动真实 core ProfileStore。
interface ProfileActions {
    val profiles: StateFlow<List<Profile>>
    val activeProfile: StateFlow<Profile?>

    /** 激活切换 + applyConfigurationChange。 */
    suspend fun activate(id: String)

    /** 删除（激活提升语义在 ProfileStore.remove）。 */
    suspend fun deleteProfile(id: String)

    /** 改名（去空白与空名拒绝在 ProfileStore.rename）。 */
    suspend fun renameProfile(id: String, name: String): RenameOutcome

    /** 按 id 取存下来的原文（详情的「复制内容」）；非激活项按需回读，不常驻。 */
    suspend fun profileContent(id: String): String

    /** 手动刷新（写回不变量在 core ConfigRefresh）。 */
    suspend fun refreshProfile(url: String): RefreshOutcome

    /** 激活配置的今日账本（只读；写者恒是隧道进程）。 */
    suspend fun usageRecord(profileId: String): UsageRecordSnapshot
}

// 规则页动作契约（两端同名对齐 iOS App/AppActions.swift）：RulesViewModel
// 只依赖此窄面、不直持 RuleStore。「持久化 → 重发快照 → applyConfigurationChange」在实现内
// 绑定为单点，调用方不可能漏掉重启。
interface RuleActions {
    /** 规范序快照流（序/去重唯一实现于 RuleStore）。 */
    val rules: StateFlow<List<Rule>>

    /** 批量加入（幂等去重在 RuleStore）。 */
    suspend fun addRules(rules: List<Rule>)

    /** 以新三元组替换原条目（跨 action/kind 迁移与幂等去重在 RuleStore）。 */
    suspend fun replaceRule(old: Rule, new: Rule)

    /** 删除既有条目。 */
    suspend fun removeRule(rule: Rule)
}

// 配置查看页动作契约：ConfigViewModel 只依赖此窄面。
// 生产唯一实现 = AppActions；JVM 单测以假实现打桩。
interface ConfigActions {
    /** Imported 视图取激活 profile 的原文（空串 = 无激活，整页空态；非激活内容不常驻）。 */
    val activeConfigContent: StateFlow<String>

    /** 进入页面先等数据就绪，再以当前输入合并。 */
    suspend fun awaitDataReady()

    /** 合并唯一出口（与启动路径同一实现）。 */
    suspend fun mergedConfig(): String

    /** 元信息行的当前路由模式。 */
    fun routingMode(): RoutingMode
}

// 应用动作的单一可复用层：UI（ViewModel）与开发期命令 harness 共用同一套底层动作，各自不重造。
// 同时是 profile 与规则全部变更的唯一漏斗（变更命令落地后重发对应快照；规则变更绑定 applyConfigurationChange）、
// 延迟测试的唯一触发单点与动作事件的 APP 日志喂入点。
// 观察态转发/合并自 controller/client 的 StateFlow；命令转发到 controller / core 流水线 / client 与纯探针函数。
class AppActions(
    private val controller: TunnelController,
    private val client: TunnelClient,
    private val dataRepository: AppDataRepository,
    private val modeStore: RoutingModeStore,
    private val regionStore: RegionStore,
    private val logStore: LogStore,
    // 单跳 HTTP 客户端；两跳编排由本类装配成 AcceleratedConfigFetcher。
    private val fetcher: ConfigFetcher,
    private val userAgent: () -> String,
    // 本机用量的只读入口与孤儿回收单点。
    private val usageReader: UsageReader,
    val debugConfigUrl: String,
    private val devPreferences: DevPreferences,
    // 加速代理 base URL（构建期注入，可为空串 = 未配置）。
    private val acceleratorBase: String,
    private val refreshRecords: RefreshRecordStore,
    // 记录时刻的唯一读取口：core 不读时钟，测试注入假时钟。
    private val clock: () -> Long = System::currentTimeMillis,
    private val scope: CoroutineScope,
    // 后台自动更新开关变更钩子：注册/注销周期任务；调度器是平台件，故由装配处接。
    private val onBackgroundRefreshChanged: (Boolean) -> Unit = {},
) : ImportActions, ProfileActions, RuleActions, ConfigActions {
    val connected: StateFlow<Boolean> = controller.connected
    val status: StateFlow<EngineStatus> = controller.status
    val tunnelStateKnown: StateFlow<Boolean> = controller.stateKnown

    /** 本次隧道会话连上的时刻（`SystemClock.elapsedRealtime` 口径）；不在会话里为 null。首页本次时长按它现算。 */
    val sessionStartedAt: StateFlow<Long?> = controller.sessionStartedAt
    val dataLoaded: StateFlow<Boolean> = dataRepository.loaded
    val traffic: StateFlow<Traffic> = client.traffic
    val memoryTrend: StateFlow<MemoryTrend> = client.memoryTrend
    val rateTrend: StateFlow<TrafficRateTrend> = client.rateTrend

    // 观察通道健康度与最近一帧时刻。断流态由通道层主动推，呈现层据此表态，
    // 不在读取处按当前时间自己算（StateFlow 只在**值变化**时发射，时间流逝不改变任何值）。
    val observationHealth: StateFlow<ObservationHealth> = client.observationHealth
    val lastFrameAtMillis: StateFlow<Long?> = client.lastFrameAtMillis

    /** 读数是否已不可信（观察通道断流，或本次会话尚无帧）。 */
    fun trafficStale(): Boolean = client.trafficStale()

    /** 距最近一帧的毫秒数；null = 本次会话尚无任何帧。 */
    fun observationElapsedMillis(): Long? = client.observationElapsedMillis()
    val groups: StateFlow<List<NodeGroup>> = client.groups
    val groupsGeneration: StateFlow<Int> = client.groupsGeneration

    override val profiles: StateFlow<List<Profile>> = dataRepository.profiles
    override val activeProfile: StateFlow<Profile?> = dataRepository.activeProfile
    override val activeConfigContent: StateFlow<String> = dataRepository.activeConfigContent
    override val rules: StateFlow<List<Rule>> = dataRepository.rules

    // 启动失败诊断：OS 广播通道优先，Monitor 通道（onError 事件 + 持久化兜底）补位；
    // 两通道各自在下次成功启动清空，合并值随之回 null。
    // 诊断与其观察时刻是一个值（FailureDiagnostic）：并列两条流会让「错误已到、时刻未到」
    // 成为可观察中间态，弹层恰在那一拍快照就会把在线失败定格成「—」。
    val failure: StateFlow<FailureDiagnostic?> =
        combine(controller.failure, client.failure) { broadcast, monitor -> broadcast ?: monitor }
            .stateIn(scope, SharingStarted.Eagerly, controller.failure.value ?: client.failure.value)

    /**
     * 失败弹层配置指纹行：当前激活 profile 存储内容的指纹（不含内容本身）。
     * 有意差异（RN 另列 merged 半）：merged 需在弹层内重跑一次模板合并，会把一行诊断变成加载态；
     * 合并输入（路由模式 / 规则 / 内核参数 / 直连 DNS）在应用内各自可查，不在此重复。
     */
    val startConfigFingerprint: String?
        get() = ConfigFingerprint.of(activeConfigContent.value)

    // 两跳抓取只装配一次，导入与刷新共用同一实例（三条路径零分支）。
    private val acceleratedFetcher: ConfigFetcher = AcceleratedConfigFetcher(
        direct = fetcher,
        trustedSha256 = DomainVerify.TRUSTED_SHA256,
        acceleratorBase = { acceleratorBase },
        forceFallback = devPreferences::forceFallback,
        onAttempt = { lastAttempt = it },
    )

    // 上一次抓取走了哪条路。读它的前提是「任一时刻至多一个抓取在飞」——
    // 全部抓取都排在 dataRepository 的单并发 IO lane 上，故读到的必是自己那一次。
    private var lastAttempt = FetchAttempt(FetchRoute.PRIMARY, null)

    // 延迟测试窗口：触发即开 12s 窗口（期间 delay=0 视为测试中），窗口关闭回落「无数据」展示。
    private val _latencyTesting = MutableStateFlow(false)
    val latencyTesting: StateFlow<Boolean> = _latencyTesting.asStateFlow()

    // 最近一次探测胜者（null = 未探测过或零响应）；合并装配与设置页 DNS 行消费，
    // 连接期间不变——已连接时展示值恒等于启动配置所用值。
    private val _directDns = MutableStateFlow<String?>(null)
    val directDns: StateFlow<String?> = _directDns.asStateFlow()

    private val dnsFlightGuard = Mutex()
    private var dnsFlight: Deferred<String?>? = null
    private val restartGuard = Mutex()
    private val connectionIntent = ConnectionIntentGate()

    /**
     * 全仓唯一探测入口（单飞）——启动路径在合并装配前 await；并发调用共享同一在途竞速。
     * 结局写内存态 + 一行 APP 日志；竞速与阻塞 IO 在 net/DnsRace（不占主线程）。
     *
     * 「隧道未完全停止时不发包」的门在这里而不在各调用点：入口只有一个，门也只该有一处。
     */
    suspend fun refreshDirectDns(): String? {
        if (!directDnsProbeAllowed(osConnected = connected.value, engineStatus = status.value)) {
            // 隧道未完全停止时不发包：此刻的 UDP:53 会被自己的 hijack-dns 就地作答，
            // 测出来的胜者与直连可达性无关。沿用上一次隧道未建立时的胜者。
            logStore.append(
                LogSource.APP,
                LogLevel.DEBUG,
                "direct dns probe skipped: tunnel not fully stopped",
            )
            return _directDns.value
        }
        val flight = dnsFlightGuard.withLock {
            dnsFlight?.takeIf { it.isActive } ?: scope.async {
                val winner = raceDnsProbe()
                // 出发时开着的门，回来时可能已经关了：竞速期间隧道被别的入口（On-Demand / 快捷开关）
                // 连上，这次竞速的应答就已经是被 hijack-dns 就地作答的那种。开始时检查不够，落盘前再判一次。
                if (!directDnsProbeAllowed(osConnected = connected.value, engineStatus = status.value)) {
                    logStore.append(
                        LogSource.APP,
                        LogLevel.DEBUG,
                        "direct dns probe discarded: tunnel came up mid-probe",
                    )
                    return@async _directDns.value
                }
                _directDns.value = winner
                // 探测结局 debug 级(默认呈现档不显示,日志页调 debug 追溯可见)。
                logStore.append(LogSource.APP, LogLevel.DEBUG, "direct dns probe: ${winner ?: "none"}")
                winner
            }.also { dnsFlight = it }
        }
        return flight.await()
    }
    private var latencyWindow: Job? = null

    init {
        // Store 构造会读盘；预热必须离开主线程，所有后续命令也复用同一串行数据 lane。
        scope.launch { dataRepository.initialize() }
        // 节点测速触发一：连接成功上升沿（覆盖手动连接与配置变更走完整重启那一支；
        // 热重载不产生该沿，节点重测由 activate 的 triggerNodeTests 承担）。
        scope.launch {
            var previous = connected.value
            connected.collect { now ->
                if (!previous && now) triggerNodeTests()
                previous = now
            }
        }
        // 孤儿回收：只在隧道**确已停止**时做——运行中的采样器是那些文件的唯一写者。
        // 判据取「OS 未连接 **且** 引擎阶段为 STOPPED」：只看 connected 会把启动中与停止中
        // 也算成「没在跑」，那两个阶段采样器仍可能在写。
        scope.launch {
            combine(connected, status) { running, phase -> !running && phase == EngineStatus.STOPPED }
                .collect { idle -> if (idle) reclaimUsageRecords() }
        }
    }

    /** 读一个配置的本机账本（账本与「有无记录」同一次读出）；约 68 KB，不占主线程。 */
    override suspend fun usageRecord(profileId: String): UsageRecordSnapshot =
        withContext(Dispatchers.IO) { usageReader.load(profileId) }

    private suspend fun reclaimUsageRecords() {
        val ids = dataRepository.profileIds()
        withContext(Dispatchers.IO) { usageReader.reclaim(ids) }
    }

    fun connect() {
        val request = connectionIntent.requestConnection()
        logAction("connect requested")
        scope.launch {
            restartGuard.withLock {
                if (!connectionIntent.isCurrentConnectionRequest(request)) return@withLock
                try {
                    startAndHonorConnectionIntent()
                } catch (_: TunnelStartException) {
                    // 结局经 lastError 可观察。
                }
            }
        }
    }

    fun disconnect() {
        connectionIntent.requestDisconnection()
        logAction("disconnect requested")
        controller.clearPreparedStartConfig()
        // 用户主动断开划出一段的终点 —— 跨过它还活着的旧诊断，下一拍会被当成新结局重新呈现
        // （用户看到的是「我点了关闭，它弹出上次的失败」）。`failure` 是两条通道 combine 出来的，故两处都清。
        controller.clearFailureDiagnostics()
        client.clearFailure()
        controller.requestStop()
    }

    fun toggle() {
        if (connected.value) disconnect() else connect()
    }

    /**
     * 配置查看页 Merged 视图与启动路径共用的合并出口（唯一实现于 TunnelController.mergedConfig）。
     * MergeError（领域错误）原样上抛，由调用方映射为可重试失败态。
     */
    override suspend fun mergedConfig(): String = controller.mergedConfig()

    /** 配置查看页进入时等待首份磁盘快照，避免把“尚未加载”误呈现为“没有 profile”。 */
    override suspend fun awaitDataReady() = dataRepository.awaitLoaded()

    /** 当前路由模式（持久化唯一读取处在 RoutingModeStore，默认 tun-rules）。 */
    override fun routingMode(): RoutingMode = modeStore.get()

    /** 切换 = 立即持久化 + applyConfigurationChange（持久化先于重启；未运行零引擎调用）。 */
    suspend fun setRoutingMode(mode: RoutingMode) {
        modeStore.set(mode)
        applyConfigurationChange()
    }

    /** 当前区域（持久化唯一读取处在 RegionStore，默认 cn）。 */
    fun region(): Region = regionStore.get()

    /**
     * 区域切换 = 只持久化（纯占位）。
     * 刻意不 applyConfigurationChange、不碰合并配置——本设置零运行时效果。
     */
    fun setRegion(region: Region) {
        regionStore.set(region)
    }

    override fun requiresVpnConsent(payload: ImportPayload): Boolean =
        requiresVpnConsent(payload, DomainVerify.TRUSTED_SHA256)

    /** 导入流水线：相位经 onPhase 依序可见，终态即返回值。 */
    override suspend fun importProfile(payload: ImportPayload, onPhase: (ImportPhase) -> Unit): ImportPhase {
        if (payload.requestedApply) connectionIntent.requestConnection()
        val importTunnel = ImportTunnelControl()
        val outcome = coroutineScope {
            val phases = Channel<ImportPhase>(Channel.UNLIMITED)
            val pipeline = async {
                try {
                    dataRepository.runProfilePipeline { store ->
                        importFlow(store, importTunnel).run(payload) { phase ->
                            phases.trySend(phase).getOrThrow()
                        }
                    }
                } finally {
                    importTunnel.releaseRestartGuard()
                    phases.close()
                }
            }
            for (phase in phases) onPhase(phase)
            pipeline.await()
        }
        // 终态 token 稳定，日志不携 URL（域名保密纪律：明文主机名不入日志）。
        logAction("import ${outcome.token}", level = if (outcome is ImportPhase.Failed) LogLevel.ERROR else LogLevel.INFO)
        return outcome
    }

    /** 激活切换；隧道处置 = applyConfigurationChange 单点（重启失败经 lastError 进失败弹层，不上抛）。 */
    override suspend fun activate(id: String) {
        dataRepository.activateProfile(id)
        logAction("profile activated: ${activeProfile.value?.name}")
        putActiveProfileInUse()
    }

    /**
     * 让当前配置在隧道里生效（导入成功页的「立即使用」）。刚导入的那一份已是当前项，
     * 而手动导入只同步启动快照、不动正在跑的隧道；这一步补上与切换配置同一条隧道处置。
     * 发在应用作用域：调用方随即离开导入页，页面的作用域会把它一起取消。
     */
    fun useActiveProfile() {
        logAction("active profile put in use")
        scope.launch { putActiveProfileInUse() }
    }

    private suspend fun putActiveProfileInUse() {
        applyConfigurationChange()
        triggerNodeTests() // 节点测速触发二：激活 profile 变化（未连接时空操作）。
    }

    /** 删除（激活提升语义在 ProfileStore.remove，本层只重发快照）。 */
    override suspend fun deleteProfile(id: String) {
        dataRepository.deleteProfile(id)
    }

    /** 改名：只有写入了才记一笔（空名被 core 拒绝时名字不变，没有可记的）。 */
    override suspend fun renameProfile(id: String, name: String): RenameOutcome =
        dataRepository.renameProfile(id, name).also { outcome ->
            if (outcome == RenameOutcome.RENAMED) logAction("profile renamed")
        }

    override suspend fun profileContent(id: String): String = dataRepository.profileContent(id)

    /** 手动刷新（写回不变量归 core ConfigRefresh / ProfileStore.applyRefresh）。 */
    override suspend fun refreshProfile(url: String): RefreshOutcome {
        val outcome = runRefresh(url, RefreshTrigger.MANUAL)
        val message = when (outcome) {
            is RefreshOutcome.Updated -> "profile refresh updated (contentChanged=${outcome.contentChanged})"
            RefreshOutcome.Dropped -> "profile refresh dropped"
            is RefreshOutcome.Failed -> "profile refresh failed: ${outcome.error.token}"
        }
        // 级别指派:失败 error / dropped warn(写回被整条丢弃值得注意)/ 更新 info。
        val level = when (outcome) {
            is RefreshOutcome.Failed -> LogLevel.ERROR
            RefreshOutcome.Dropped -> LogLevel.WARN
            is RefreshOutcome.Updated -> LogLevel.INFO
        }
        logAction(message, level)
        return outcome
    }

    /** 对全部 profile 各刷一次，**串行逐个**——并发批量会打破内容驻留不变量。
     *
     * 「任意时刻至多一条刷新管线在运行」同样靠这条串行：刷新入口有三个（下拉 / 列表上方「更新全部」/
     * 行菜单「刷新」）且互不相看，至多一条在跑靠的是 [runRefresh] 落到的那条并行度 1 的数据 lane，
     * 不是入口互斥。
     */
    suspend fun refreshAllProfiles() {
        val urls = dataRepository.runProfilePipeline { store -> store.getAll().map(Profile::url) }
        for (url in urls) runRefresh(url, RefreshTrigger.AUTO)
        logAction("background refresh swept ${urls.size} profiles")
    }

    /** 一次刷新 = 一次写回 + 一条执行记录。记录写在同一条 IO lane 上，与写回同序。 */
    private suspend fun runRefresh(url: String, trigger: RefreshTrigger): RefreshOutcome {
        val startedAt = clock()
        lastAttempt = FetchAttempt(FetchRoute.PRIMARY, null)
        return dataRepository.runProfilePipeline { store ->
            val outcome = ConfigRefresh(acceleratedFetcher, store, userAgent, clock).run(url)
            refreshRecords.append(recordOf(store, url, trigger, outcome, startedAt))
            outcome
        }
    }

    private fun recordOf(
        store: ProfileStore,
        url: String,
        trigger: RefreshTrigger,
        outcome: RefreshOutcome,
        startedAt: Long,
    ): RefreshRecord {
        // 来源已删（Dropped）时取不到 profile：id/name 留空，那正是「写回落了空」的如实记录。
        val profile = store.getAll().firstOrNull { it.url == url }
        val finishedAt = clock()
        return RefreshRecord(
            occurredAtMillis = finishedAt,
            profileId = profile?.id.orEmpty(),
            profileName = profile?.name.orEmpty(),
            trigger = trigger,
            outcome = when (outcome) {
                is RefreshOutcome.Updated -> RefreshRecordOutcome.UPDATED
                RefreshOutcome.Dropped -> RefreshRecordOutcome.DROPPED
                is RefreshOutcome.Failed -> RefreshRecordOutcome.FAILED
            },
            contentChanged = outcome is RefreshOutcome.Updated && outcome.contentChanged,
            durationMillis = finishedAt - startedAt,
            route = lastAttempt.route,
            denial = lastAttempt.denial,
            errorToken = (outcome as? RefreshOutcome.Failed)?.error?.token.orEmpty(),
            usedTraffic = profile?.usedTraffic ?: 0L,
            totalTraffic = profile?.totalTraffic ?: 0L,
            expireTime = profile?.expireTime ?: 0L,
        )
    }

    /** 时间线快照，最新在前。 */
    fun refreshRecordTimeline(): List<RefreshRecord> = refreshRecords.all()

    /** 开关只改「主 URL 那一跳的结局」，闸门不变。 */
    fun forceFallback(): Boolean = devPreferences.forceFallback()

    fun setForceFallback(enabled: Boolean) {
        devPreferences.setForceFallback(enabled)
        logAction("force fallback set: $enabled")
    }

    /** 开关翻转即刻同步周期任务的注册/注销。 */
    fun backgroundRefresh(): Boolean = devPreferences.backgroundRefresh()

    fun setBackgroundRefresh(enabled: Boolean) {
        devPreferences.setBackgroundRefresh(enabled)
        onBackgroundRefreshChanged(enabled)
        logAction("background refresh set: $enabled")
    }

    /** 批量加入（幂等去重在 RuleStore）→ 重发快照 → applyConfigurationChange。 */
    override suspend fun addRules(rules: List<Rule>) {
        dataRepository.addRules(rules)
        logAction("rules added: ${rules.size}")
        applyConfigurationChange()
    }

    /** replace 迁移（跨 action/kind 与幂等去重在 RuleStore）→ 重发快照 → applyConfigurationChange。 */
    override suspend fun replaceRule(old: Rule, new: Rule) {
        dataRepository.replaceRule(old, new)
        logAction("rule replaced")
        applyConfigurationChange()
    }

    /** 删除 → 重发快照 → applyConfigurationChange。 */
    override suspend fun removeRule(rule: Rule) {
        dataRepository.removeRule(rule)
        logAction("rule removed")
        applyConfigurationChange()
    }

    fun selectNode(tag: String) {
        client.selectNode(tag)
    }

    /** 节点测速触发三：回前台（App 的前台上升沿回调调用；未连接时空操作）。 */
    fun appForegrounded() {
        controller.refreshState()
        triggerNodeTests()
    }

    // 节点测速触发单点：对出口选择组 urlTest 一次并开 12s 展示窗口；
    // 此后由引擎配置内周期驱动，全仓无任何手动测速入口。
    // 只测出口选择组：它的成员由引擎交给覆盖它们的自动组去量，再对自动组发一次只会让同一批
    // 节点紧接着被重测一轮。
    private fun triggerNodeTests() {
        if (!connected.value) return
        _latencyTesting.value = true
        client.urlTest(NodeSelection.EXIT_GROUP_TAG)
        latencyWindow?.cancel()
        latencyWindow = scope.launch {
            delay(TESTING_WINDOW_MS)
            _latencyTesting.value = false
        }
    }

    // 配置变更处置单点：已连接 → 热重载（系统 VPN 会话不断）；
    // 正在启动 → 完整重启；未运行 → 零隧道调用。判据在 core，本层不自行判断该做哪一种。
    //
    // 变更种类由调用方声明，处置仍只由 core 给出：高级设置及其子页传 NEXT_START_ONLY，它在
    // core 里先于相位判定恒判 NONE。改在本层写一个 if，两端立刻各有一份判据，
    // 且不再受 golden 裁判。
    //
    // 失败不上抛、页内不二次呈现：诊断已由启动/重载路径落 lastError → 全局失败弹层单点，
    // 此处拦下的只是同一失败的重复通道（不是吞错）。
    private suspend fun applyConfigurationChange(change: ConfigChange = ConfigChange.ENGINE_CONFIG) {
        restartGuard.withLock {
            if (!connectionIntent.allowsStart()) return
            // 两个输入取同一个「已沉降」时刻：先等启动中相位落定，再读连接真相。
            val engineStatus = controller.statusForConfigurationChange()
            val phase = sessionPhase(osConnected = connected.value, engineStatus = engineStatus)
            when (configChangeDisposition(phase, change)) {
                ConfigChangeDisposition.NONE -> return
                ConfigChangeDisposition.RELOAD -> reloadForConfigurationChange()
                ConfigChangeDisposition.RESTART -> restartForConfigurationChange()
            }
        }
    }

    private suspend fun reloadForConfigurationChange() {
        if (!connectionIntent.allowsStart()) return
        try {
            controller.reload()
        } catch (_: TunnelStartException) {
            // 不自愈,但也**不能装作没事**:装配失败（探测/合并/落盘）发生在命令发出之前,
            // 隧道那边什么都没听见,旧引擎会带着旧配置继续跑——而设定已经落盘、UI 已经改了,
            // 显示的设定与实际生效的配置会长期不一致。故一律拆到 STOPPED。
            // 引擎侧失败时隧道已在停止途中,这一发请求是幂等空操作。
            controller.requestStop()
        }
    }

    private suspend fun restartForConfigurationChange() {
        if (!connectionIntent.allowsStart()) return
        // 装配次序：先停到 OS 确认断开，再装配。装配含直连 DNS 探测，而隧道还在跑的那一刻
        // 探测被自己的 hijack-dns 就地作答（探测入口会拒发包），停止前装配的那份永远拿不到新鲜的直连值。
        controller.stop()
        if (!connectionIntent.allowsStart()) return
        try {
            controller.prepareNextStartConfig()
        } catch (failed: TunnelStartException) {
            // 装配失败发生在停止之后：隧道已断，诊断经 lastError → 失败弹层，不留「UI 显示新设定、
            // 实际跑着旧配置」的不一致（与 reloadForConfigurationChange 同一条理由）。
            return
        }
        try {
            startAndHonorConnectionIntent()
        } catch (_: TunnelStartException) {
            // 结局经 lastError 可观察。
            // 启动若在消费 prepared 配置**之前**就失败（如停止等待超时），那份令牌会一直留到
            // 被下一次普通连接消费——那次连接就会用上一份早已过期的配置。清掉它。
            controller.clearPreparedStartConfig()
        }
    }

    /** 所有 UI 侧启动共用的最后一道意图检查；断开发生在启动窗口内时，启动返回后立即收口。 */
    private suspend fun startAndHonorConnectionIntent() {
        if (!connectionIntent.allowsStart()) throw TunnelStartException(CONNECTION_CANCELLED)
        try {
            controller.start()
        } finally {
            if (!connectionIntent.allowsStart()) controller.stop()
        }
    }

    // APP 日志喂入单点：动作层事件（导入/激活/刷新/规则变更/连接断开）入唯一缓冲。
    private fun logAction(message: String, level: LogLevel = LogLevel.INFO) {
        logStore.append(LogSource.APP, level, message)
    }

    private fun importFlow(store: ProfileStore, tunnel: TunnelControl) = ImportFlow(
        // 强制回落开关也覆盖导入路径：三条抓取路径共用同一个两跳实现，无分支。
        fetcher = acceleratedFetcher,
        tunnel = tunnel,
        store = store,
        trusted = DomainVerify.TRUSTED_SHA256,
        userAgent = userAgent,
        now = { System.currentTimeMillis() },
        newId = { UUID.randomUUID().toString() },
    )

    /** apply 导入从实际停止开始独占隧道生命周期；下载失败、取消和启动结局都由 finally 释放。 */
    private inner class ImportTunnelControl : TunnelControl {
        private var ownsRestartGuard = false

        override suspend fun stop() {
            restartGuard.lock(this)
            ownsRestartGuard = true
            controller.stop()
        }

        override suspend fun start() = startAndHonorConnectionIntent()

        fun releaseRestartGuard() {
            if (!ownsRestartGuard) return
            ownsRestartGuard = false
            restartGuard.unlock(this)
        }
    }

    companion object {
        private const val CONNECTION_CANCELLED = "connection cancelled by newer disconnect request"
        private const val TESTING_WINDOW_MS = 12_000L
    }
}

/** Android 首装授权前置只覆盖最终会自动应用的受信载荷，未受信载荷仍降级为手动导入。 */
internal fun requiresVpnConsent(payload: ImportPayload, trusted: Set<String>): Boolean =
    payload.requestedApply && DomainVerify.verify(UrlInfo.hostname(payload.url), trusted)

internal class ConnectionRequest internal constructor(internal val generation: Long)

/** 显式用户连接意图的单一真相；初始未知允许恢复已存在的系统隧道。 */
internal class ConnectionIntentGate {
    private enum class Preference { UNSPECIFIED, CONNECTED, DISCONNECTED }

    private var generation = 0L
    private var preference = Preference.UNSPECIFIED

    @Synchronized
    fun requestConnection(): ConnectionRequest {
        generation += 1
        preference = Preference.CONNECTED
        return ConnectionRequest(generation)
    }

    @Synchronized
    fun requestDisconnection() {
        generation += 1
        preference = Preference.DISCONNECTED
    }

    @Synchronized
    fun isCurrentConnectionRequest(request: ConnectionRequest): Boolean =
        preference == Preference.CONNECTED && request.generation == generation

    @Synchronized
    fun allowsStart(): Boolean = preference != Preference.DISCONNECTED
}
