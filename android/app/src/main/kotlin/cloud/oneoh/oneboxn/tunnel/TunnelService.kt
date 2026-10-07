package cloud.oneoh.oneboxn.tunnel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.IpPrefix
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import cloud.oneoh.oneboxn.bridge.EngineBinding
import cloud.oneoh.oneboxn.bridge.StartDiagnostic
import cloud.oneoh.oneboxn.core.Engine
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.FailureSource
import cloud.oneoh.oneboxn.core.EngineStatus
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.TunHost
import cloud.oneoh.oneboxn.core.TunPrefix
import cloud.oneoh.oneboxn.core.UsageHistory
import cloud.oneoh.oneboxn.core.TunSpec
import cloud.oneoh.oneboxn.core.TunnelTeardown
import cloud.oneoh.oneboxn.core.describe
import java.io.File
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// OS 隧道进程入口（:tun）：VpnService 子类 + TunHost。持 EngineBinding 驱动内核，
// 从中立 TunSpec 建 TUN 并 establish，前台运行，并把生命周期阶段广播回 UI（连接真相）。
class TunnelService : VpnService(), TunHost {

    // 每次启动构造一台引擎（per-start）；stop/onDestroy 路径以可空引用收口——
    // 启动前或构造失败时为 null，停止即空操作（no-op）。
    private val notification by lazy { ServiceNotification(this) }
    private val configHandoff by lazy { TunnelConfigHandoff(File(cacheDir, CONFIG_HANDOFF_DIRECTORY)) }
    private val engineLease = TunnelEngineLease()
    private val startWorker = Executors.newSingleThreadExecutor()
    private val controlWorker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val descriptorLock = Any()

    @Volatile private var phase = EngineStatus.STOPPED

    /** 本次会话连上的时刻，见 [TunnelSignals.EXTRA_SESSION_STARTED_AT]；只在 STARTED 那一沿写。 */
    private var sessionStartedAtMillis: Long? = null
    private var fileDescriptor: ParcelFileDescriptor? = null
    private var controlReceiverRegistered = false
    private var idleReceiverRegistered = false

    // Doze 广播在没有引擎的时段里会成串到达：一段一行，下一次交给引擎时带出计数（只在主线程访问）。
    private val idleSkips = SkipLog<IdleSkip>("idle mode") { writeLog(it) }
    @Volatile private var destroyed = false

    private val controlReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                TunnelSignals.ACTION_STOP -> stopTunnel()
                TunnelSignals.ACTION_NOTIFICATION_DISMISSED -> notification.onDismissed()
                TunnelSignals.ACTION_RELOAD -> reloadTunnel(intent)
                TunnelSignals.ACTION_QUERY_STATE -> broadcastState(
                    state = phase,
                    queryId = intent.getLongExtra(TunnelSignals.EXTRA_QUERY_ID, 0L),
                )
            }
        }
    }

    // Doze 进出：熄屏一段时间后系统进入 idle，周期性探测既打不通也会把设备唤醒。
    // 这里只转发睡 / 醒沿：睡够久醒来要不要重置网络由引擎按睡眠时长决定，同一次睡眠只重置一次
    // 也由它去重，宿主另起重置会绕过这两条判定。重置没排进队列时引擎报错、下一次醒来重试，记下即可。
    private val idleReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED) {
                idleSkips.skip(IdleSkip.UNEXPECTED_ACTION, "${intent.action}")
                return
            }
            val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: run {
                idleSkips.skip(IdleSkip.POWER_MANAGER_UNAVAILABLE)
                return
            }
            val engine = engineLease.current() ?: run {
                idleSkips.skip(IdleSkip.NO_ENGINE)
                return
            }
            idleSkips.delivered()
            controlWorker.execute {
                runCatching {
                    if (power.isDeviceIdleMode) engine.pause() else engine.wake()
                }.onFailure { Log.w(TAG, "idle mode dispatch failed", it) }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        ContextCompat.registerReceiver(
            this,
            controlReceiver,
            IntentFilter().apply {
                addAction(TunnelSignals.ACTION_STOP)
                addAction(TunnelSignals.ACTION_RELOAD)
                addAction(TunnelSignals.ACTION_QUERY_STATE)
                addAction(TunnelSignals.ACTION_NOTIFICATION_DISMISSED)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        controlReceiverRegistered = true
        // 系统广播，必须 EXPORTED（RECEIVER_NOT_EXPORTED 会让它永远收不到）。
        ContextCompat.registerReceiver(
            this,
            idleReceiver,
            IntentFilter(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED),
            ContextCompat.RECEIVER_EXPORTED,
        )
        idleReceiverRegistered = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val configToken = intent?.getStringExtra(TunnelSignals.EXTRA_CONFIG_TOKEN)
            ?: error("missing config token extra")
        if (phase != EngineStatus.STOPPED) {
            controlWorker.execute { runCatching { configHandoff.discard(configToken) } }
            broadcastState(phase)
            return START_NOT_STICKY
        }
        // 用量记账归属：空串 = 未归属（debug 引导配置即此），该会话不记账；缺失不是装配 bug。
        installUsageRecorder(intent.getStringExtra(TunnelSignals.EXTRA_PROFILE_ID).orEmpty())

        val start = engineLease.beginStart()
        phase = EngineStatus.STARTING
        StartDiagnostic.clear(this)
        broadcastState(EngineStatus.STARTING)
        notification.ensureChannel()
        // 渲染器是**服务级**的，装在这里、只在 stopTunnel 与 onDestroy 卸；
        // 热重载窗口内不装不卸（那会让通知闪一下）。
        notification.start()
        MonitorHub.installNotificationRenderer(notification)
        startForegroundCompat()

        startWorker.execute {
            try {
                val config = configHandoff.take(configToken)
                if (config.isBlank()) error("empty configuration")
                // 构造失败经既有 catch 落 fail()。
                val bound = newEngine()
                if (!engineLease.install(start, bound)) {
                    runCatching { bound.stop() }
                    return@execute
                }
                bound.start(config)
                mainHandler.post {
                    if (!destroyed &&
                        phase == EngineStatus.STARTING &&
                        engineLease.isCurrent(start, bound)
                    ) {
                        phase = EngineStatus.STARTED
                        sessionStartedAtMillis = SystemClock.elapsedRealtime()
                        broadcastState(EngineStatus.STARTED)
                        Log.i(TAG, "tunnel started")
                    }
                }
            } catch (t: Throwable) {
                Log.e(TAG, "engine start failed", t)
                mainHandler.post {
                    if (!destroyed &&
                        phase == EngineStatus.STARTING &&
                        engineLease.isCurrent(start)
                    ) {
                        // 来源 = 引擎：这一跳是引擎的 start 抛出来的，写进启动诊断文件的也正是它。
                        fail(EngineError("START_FAILED_GENERIC", describe(t)), FailureSource.ENGINE)
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    // —— TunHost ——

    override fun openTun(spec: TunSpec): Int {
        if (prepare(this) != null) error("android: missing vpn permission")
        val builder = Builder().setSession(SESSION).setMtu(spec.mtu)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

        var hasInet4 = false
        var hasInet6 = false
        for (address in spec.inet4Addresses) {
            builder.addAddress(address.address, address.prefix)
            hasInet4 = true
        }
        for (address in spec.inet6Addresses) {
            builder.addAddress(address.address, address.prefix)
            hasInet6 = true
        }

        if (spec.autoRoute) {
            if (spec.dnsServer.isNotBlank()) builder.addDnsServer(spec.dnsServer)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                applyPreciseRoutes(builder, spec, RouteFamilies(hasInet4 = hasInet4, hasInet6 = hasInet6))
            } else {
                for (range in spec.inet4RouteRanges) builder.addRoute(range.address, range.prefix)
                for (range in spec.inet6RouteRanges) builder.addRoute(range.address, range.prefix)
            }
            for (pkg in spec.includePackages) {
                runCatching { builder.addAllowedApplication(pkg) }
                    .onFailure { Log.w(TAG, "addAllowedApplication $pkg: ${it.message}") }
            }
            for (pkg in spec.excludePackages) {
                runCatching { builder.addDisallowedApplication(pkg) }
                    .onFailure { Log.w(TAG, "addDisallowedApplication $pkg: ${it.message}") }
            }
        }

        val pfd = builder.establish() ?: error("android: establish returned null (revoked?)")
        // 热重载会再次走到这里：**先装上新描述符，再关旧的**。反过来会在两者之间
        // 留出一段没有接口的空窗；平台不承诺接口身份连续，但这个次序至少不由我们制造断点。
        val previous = synchronized(descriptorLock) {
            if (phase != EngineStatus.STARTING && phase != EngineStatus.STARTED) {
                pfd.close()
                error("android: tunnel establishment canceled")
            }
            fileDescriptor.also { fileDescriptor = pfd }
        }
        previous?.let { runCatching { it.close() } }
        Log.i(TAG, "TUN established fd=${pfd.fd}")
        return pfd.fd
    }

    // protect(fd) 由 VpnService 基类提供，同时满足 TunHost.protect（同签名）——显式转调基类实现。
    override fun protect(fd: Int): Boolean = super<VpnService>.protect(fd)

    // 无条件按 debug 写入会让引擎的 warn 及以上在 logcat 的级别过滤下消失，而进程被杀后
    // 这些恰恰是唯一还取得到的行。档位按 LogLevel 全序映射；token 前缀保留，
    // 使被合并的两档仍可区分。
    override fun writeLog(line: LogLine) {
        val text = "[${line.level.token}] ${line.message}"
        when (line.level) {
            LogLevel.TRACE, LogLevel.DEBUG -> Log.d(TAG, text)
            LogLevel.INFO -> Log.i(TAG, text)
            LogLevel.WARN -> Log.w(TAG, text)
            LogLevel.ERROR, LogLevel.FATAL, LogLevel.PANIC -> Log.e(TAG, text)
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun applyPreciseRoutes(
        builder: Builder,
        spec: TunSpec,
        families: RouteFamilies,
    ) {
        if (spec.inet4Routes.isNotEmpty()) {
            spec.inet4Routes.forEach { builder.addRoute(it.toIpPrefix()) }
        } else if (families.hasInet4) {
            builder.addRoute("0.0.0.0", 0)
        }
        if (spec.inet6Routes.isNotEmpty()) {
            spec.inet6Routes.forEach { builder.addRoute(it.toIpPrefix()) }
        } else if (families.hasInet6) {
            builder.addRoute("::", 0)
        }
        (spec.inet4RouteExcludes + spec.inet6RouteExcludes).forEach { prefix ->
            val addr = InetAddress.getByName(prefix.address)
            // 回环 / 链路本地地址不能作为排除路由（会被系统拒绝）。
            if (addr.isLoopbackAddress || addr.isLinkLocalAddress) return@forEach
            builder.excludeRoute(prefix.toIpPrefix())
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun TunPrefix.toIpPrefix(): IpPrefix =
        IpPrefix(InetAddress.getByName(address), prefix)

    private data class RouteFamilies(
        val hasInet4: Boolean,
        val hasInet6: Boolean,
    )

    // —— 生命周期 ——

    override fun onRevoke() {
        stopTunnel()
    }

    // 系统内存修剪沿驱动引擎空闲回收(幂等,未启动时引擎侧零负担 no-op)。
    // 修剪回调不在数据路径上,是隧道进程唯一可靠的"该还内存了"信号。
    //
    // API 35 把除 TRIM_MEMORY_UI_HIDDEN 外的整套档位标记为废弃,但本进程是无界面的隧道
    // 服务——UI_HIDDEN 对它永不触发,换用它等于把这条回收路径整个关掉。minSdk 28 覆盖的
    // 旧版本仍按数值档位派发,故沿用阈值判定并就地压制废弃告警,不为消除一条编译警告而
    // 丢掉真实行为。
    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            engineLease.current()?.purgeIdleMemory()
        }
    }

    /**
     * 拆除有界:引擎的停止有它自己的数秒上界,而 `onDestroy` 跑在主线程——同步跑完就是
     * 拿一次 ANR(乃至被系统直接杀在拆除中途)去换一次优雅关闭。故交给控制线程,主线程只按
     * 预算等;等不到就放手,进程随即消失,内核会替我们关掉描述符。与 `stopTunnel()` 同形。
     */
    override fun onDestroy() {
        destroyed = true
        val startedAtMillis = SystemClock.elapsedRealtime()
        if (controlReceiverRegistered) {
            runCatching { unregisterReceiver(controlReceiver) }
            controlReceiverRegistered = false
        }
        if (idleReceiverRegistered) {
            runCatching { unregisterReceiver(idleReceiver) }
            idleReceiverRegistered = false
        }
        idleSkips.close()
        // 停止沿补提交：服务被系统直接销毁（未走 stopTunnel）时同样要落最后一段。
        MonitorHub.closeUsageRecorder()
        // 这条路**不**走 stopForegroundCompat（靠服务销毁自动移除通知），
        // 故渲染器必须在这里也卸一次，否则会留下一个还在投递的消费者。
        MonitorHub.installNotificationRenderer(null)
        notification.close()
        val wasRunning = phase != EngineStatus.STOPPED
        controlWorker.execute {
            stopCurrentEngine()
            closeDescriptor()
        }
        startWorker.shutdownNow()
        controlWorker.shutdown()
        val engineStopped = controlWorker.awaitTermination(
            TunnelTeardown.engineStopBudgetMillis(SystemClock.elapsedRealtime() - startedAtMillis),
            TimeUnit.MILLISECONDS,
        )
        if (wasRunning) {
            phase = EngineStatus.STOPPED
            broadcastState(EngineStatus.STOPPED)
        }
        // 拆除有界的唯一可验外部效果：这一行的耗时恒在预算内。
        Log.i(
            TAG,
            "tunnel torn down in ${SystemClock.elapsedRealtime() - startedAtMillis}ms " +
                "(engine stop: ${if (engineStopped) "completed" else "abandoned"})",
        )
        super.onDestroy()
    }

    // 拆除当前绑定并释放引用：绑定为 null 是合法的（尚未分派 / 分派失败），空操作即可；
    // 释放引用防止 STOPPED 后同一 Service 实例仍持上一轮绑定（per-start 的陈旧状态）。
    private fun stopCurrentEngine() {
        stopEngine(engineLease.beginStop())
    }

    private fun stopEngine(engine: Engine?) {
        engine?.let { runCatching { it.stop() } }
    }

    /**
     * 停止收尾的扫尾拆除:引擎在**入队时**取走,而热重载会在本任务之前跑完并装上一个新实例——
     * 那一个不在入队时的快照里,不扫就会留下一个还在跑的引擎和一条停不掉的隧道。
     *
     * 与 controlWorker 的单线程序共同保证:能被扫到的只可能是排在本任务之前的那次重载装的。
     */
    private fun sweepLateEngine() {
        stopEngine(engineLease.beginStop())
    }

    /**
     * 广播上的失败载荷：**诊断与它的来源同进同出**。
     *
     * 不作 `broadcastState` 的两个并列参数：那样能写出「有错误、没来源」与「没错误、有来源」
     * 两种组合，而只有前者有意义 —— 而它的意义（没记下 ⇒ 占位）属于**读**侧，
     * 不该由写侧用一个缺席的参数去表达。
     */
    private data class BroadcastFailure(val error: EngineError, val source: FailureSource)

    private fun fail(error: EngineError, source: FailureSource) {
        StartDiagnostic.write(this, error.detail ?: error.token)
        // 与 stopTunnel 同一条收尾纪律：这条路同样以 stopForegroundCompat 收口。
        MonitorHub.installNotificationRenderer(null)
        notification.collapse()
        phase = EngineStatus.STOPPING
        val failedEngine = engineLease.beginStop()
        controlWorker.execute {
            stopEngine(failedEngine)
            sweepLateEngine()
            closeDescriptor()
            mainHandler.post {
                if (destroyed) return@post
                stopForegroundCompat()
                notification.stop()
                phase = EngineStatus.STOPPED
                broadcastState(EngineStatus.STOPPED, BroadcastFailure(error, source))
                stopSelf()
            }
        }
    }

    /** 记录目录落 noBackupFilesDir，与 UI 侧读者同一处。 */
    private fun installUsageRecorder(profileId: String) {
        if (!UsageHistory.isValidRecordId(profileId)) {
            MonitorHub.installUsageRecorder(null)
            // 未归属会话恒落一行诊断——「本次不记账」必须可见。
            Log.w(TAG, "usage recording skipped: unattributed session")
            return
        }
        val directory = File(noBackupFilesDir, UsageHistory.DIRECTORY_NAME)
        MonitorHub.installUsageRecorder(
            UsageRecorder(
                files = UsageRecordFiles.of(directory, profileId),
                onDiagnostic = { message -> Log.w(TAG, message) },
            ),
        )
    }

    /**
     * 热重载:就地换引擎,**不停止系统 VPN 会话、不广播任何阶段**。
     *
     * 全程跑在 controlWorker 这一条单线程上,故与 stopTunnel 的引擎拆除天然互斥;`phase` 恒为
     * `STARTED`,UI 因此看不到任何过渡态。失败走既有 fail() 路径拆到 STOPPED(不自愈)。
     */
    private fun reloadTunnel(intent: Intent) {
        val reloadId = intent.getLongExtra(TunnelSignals.EXTRA_RELOAD_ID, 0L)
        val configToken = intent.getStringExtra(TunnelSignals.EXTRA_CONFIG_TOKEN)
            ?: error("missing config token extra")
        val profileId = intent.getStringExtra(TunnelSignals.EXTRA_PROFILE_ID).orEmpty()
        if (phase != EngineStatus.STARTED) {
            // 用户在同一拍手动断开:请求作废,回收一次性令牌,不弹任何失败。
            controlWorker.execute { runCatching { configHandoff.discard(configToken) } }
            broadcastReloadResult(reloadId, EngineError("RELOAD_NOT_RUNNING", "tunnel is not running"))
            return
        }
        controlWorker.execute {
            // 排队期间用户可能已按下断开：stopTunnel 在主线程同步把 phase 置为 STOPPING，
            // 故此处重核一次即可挡住「已请求停止、却又装上一个新引擎」。
            if (!canReload()) {
                runCatching { configHandoff.discard(configToken) }
                broadcastReloadResult(reloadId, CANCELLED_BEFORE_RELOAD)
                return@execute
            }
            MonitorHub.beginReload()
            try {
                // 停止沿补提交:旧归属那段先落账,再换记账归属。
                MonitorHub.closeUsageRecorder()
                val running = engineLease.current()
                installUsageRecorder(profileId)
                val config = configHandoff.take(configToken)
                if (config.isBlank()) error("empty configuration")
                if (running != null) {
                    // 就地换配置:引擎自己拆旧建新,TUN 参数没变就不回来要 fd——宿主因此不必再走一次
                    // VpnService.Builder.establish(),既有 app socket 不断。
                    running.reload(config)
                } else {
                    // 引擎已不在(被引擎自身的 serviceStop 拆过):只能新装一台。
                    val start = engineLease.beginStart()
                    val bound = newEngine()
                    if (!engineLease.install(start, bound)) {
                        // 停止/销毁抢在前面撤了这一代:那是用户取消,不是重载失败。
                        runCatching { bound.stop() }
                        abandonReload(reloadId)
                        return@execute
                    }
                    bound.start(config)
                }
                // 启动期间世界可能已经变了:停止的收尾任务可能已经扫过 lease 并走完,
                // 那样这一台就没人再来拆。就地拆掉,不指望后面还有谁收尾。
                if (!canReload()) {
                    abandonReload(reloadId)
                    return@execute
                }
                Log.i(TAG, "tunnel reloaded")
                broadcastReloadResult(reloadId, error = null)
            } catch (t: Throwable) {
                // **用户取消与真实失败必须分开**:前者不该弹失败诊断,也不该再走一次 fail()
                // 收尾(那会让一次手动断开广播两遍 STOPPED、其中一遍还带错误)。
                if (!canReload()) {
                    Log.i(TAG, "engine reload cancelled", t)
                    abandonReload(reloadId)
                    return@execute
                }
                Log.e(TAG, "engine reload failed", t)
                val failure = EngineError("RELOAD_FAILED", describe(t))
                broadcastReloadResult(reloadId, failure)
                // 来源 = 引擎：同上，热重载这一跳抛出的同样是引擎自己的失败。
                mainHandler.post { if (!destroyed) fail(failure, FailureSource.ENGINE) }
            } finally {
                MonitorHub.endReload()
            }
        }
    }

    /** 重载只在「未销毁且仍是 STARTED」时有意义;两个条件都可能在本任务运行期间翻掉。 */
    private fun canReload(): Boolean = !destroyed && phase == EngineStatus.STARTED

    /**
     * 放弃本次重载:把可能已经装上的引擎与记账器就地拆掉,回一个**非失败**的结局。
     *
     * 「非失败」是关键——走到这里说明隧道已在停止或销毁途中,那是用户的意思;
     * 登记成 RELOAD_FAILED 会让一次正常的断开弹出启动失败弹层。
     */
    private fun abandonReload(reloadId: Long) {
        stopEngine(engineLease.beginStop())
        MonitorHub.closeUsageRecorder()
        broadcastReloadResult(reloadId, CANCELLED_BEFORE_RELOAD)
    }

    private fun broadcastReloadResult(reloadId: Long, error: EngineError?) {
        val intent = Intent(TunnelSignals.ACTION_RELOAD_RESULT)
            .setPackage(packageName)
            .putExtra(TunnelSignals.EXTRA_RELOAD_ID, reloadId)
        if (error != null) {
            intent.putExtra(TunnelSignals.EXTRA_ERROR_TOKEN, error.token)
            intent.putExtra(TunnelSignals.EXTRA_ERROR_DETAIL, error.detail)
        }
        sendBroadcast(intent)
    }

    private fun newEngine(): Engine = EngineBinding(
        context = this,
        tunHost = this,
        onServiceStop = { mainHandler.post { stopTunnel() } },
    )

    private fun stopTunnel() {
        if (phase == EngineStatus.STOPPED || phase == EngineStatus.STOPPING) return
        // 停止沿补提交：先于引擎拆除，最后那不满一分钟的量才不会丢。
        MonitorHub.closeUsageRecorder()
        // 入口就卸下渲染器并作废在途投递——stopForegroundCompat 排在后面几步，
        // 期间既不能再让通知显示陈旧数字，也不能让迟到的 notify() 贴出一条没有服务托底的常驻通知。
        MonitorHub.installNotificationRenderer(null)
        notification.collapse()
        phase = EngineStatus.STOPPING
        broadcastState(EngineStatus.STOPPING)
        val stoppedEngine = engineLease.beginStop()
        controlWorker.execute {
            stopEngine(stoppedEngine)
            sweepLateEngine()
            closeDescriptor()
            mainHandler.post {
                if (destroyed) return@post
                stopForegroundCompat()
                notification.stop()
                phase = EngineStatus.STOPPED
                broadcastState(EngineStatus.STOPPED)
                stopSelf()
                Log.i(TAG, "tunnel stopped")
            }
        }
    }

    private fun closeDescriptor() {
        val descriptor = synchronized(descriptorLock) {
            fileDescriptor.also { fileDescriptor = null }
        }
        descriptor?.let { runCatching { it.close() } }
    }

    private fun startForegroundCompat() {
        val type = if (Build.VERSION.SDK_INT >= 34) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED
        } else {
            0
        }
        // 这一次恒是回落形态，不等首帧——startForegroundService 有 10 秒转前台的硬约束。
        ServiceCompat.startForeground(
            this,
            ServiceNotification.NOTIFICATION_ID,
            notification.build(),
            type,
        )
    }

    private fun stopForegroundCompat() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    }

    private fun broadcastState(
        state: EngineStatus,
        failure: BroadcastFailure? = null,
        queryId: Long? = null,
    ) {
        val intent = Intent(TunnelSignals.ACTION_STATE)
            .setPackage(packageName)
            .putExtra(TunnelSignals.EXTRA_PHASE, state.name)
        if (failure != null) {
            intent.putExtra(TunnelSignals.EXTRA_ERROR_TOKEN, failure.error.token)
            intent.putExtra(TunnelSignals.EXTRA_ERROR_DETAIL, failure.error.detail)
            // 来源随诊断同行。读侧认不出 ⇒ 占位「—」，不回落到某一个具体来源。
            intent.putExtra(TunnelSignals.EXTRA_ERROR_SOURCE, failure.source.token)
        }
        if (state == EngineStatus.STARTED) {
            intent.putExtra(
                TunnelSignals.EXTRA_SESSION_STARTED_AT,
                checkNotNull(sessionStartedAtMillis) { "tunnel started without a session start time" },
            )
        }
        queryId?.let { intent.putExtra(TunnelSignals.EXTRA_QUERY_ID, it) }
        sendBroadcast(intent)
    }

    private companion object {
        const val TAG = "TunnelService"
        const val SESSION = "OneBoxM"
        const val CONFIG_HANDOFF_DIRECTORY = "tunnel-start-config"

        /** 重载被停止/销毁抢先时的结局:调用方据此知道「没做成，但也不是坏了」。 */
        val CANCELLED_BEFORE_RELOAD = EngineError("RELOAD_NOT_RUNNING", "tunnel stopped during reload")
    }
}

private enum class IdleSkip(override val token: String, override val level: LogLevel) : SkipCause {
    NO_ENGINE("no-engine", LogLevel.DEBUG),
    UNEXPECTED_ACTION("unexpected-action", LogLevel.DEBUG),
    // 取不到系统服务不是正常时序，升到 warn。
    POWER_MANAGER_UNAVAILABLE("power-manager-unavailable", LogLevel.WARN),
}
