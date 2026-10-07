package cloud.oneoh.oneboxn

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.CreationExtras
import cloud.oneoh.oneboxn.bridge.MonitorBinding
import cloud.oneoh.oneboxn.bridge.UiForegroundState
import cloud.oneoh.oneboxn.net.HttpConfigFetcher
import cloud.oneoh.oneboxn.net.UserAgent
import cloud.oneoh.oneboxn.core.EngineInfo
import cloud.oneoh.oneboxn.core.RefreshRecordStore
import cloud.oneoh.oneboxn.profile.FileProfileStorage
import cloud.oneoh.oneboxn.profile.FileRefreshRecordStorage
import cloud.oneoh.oneboxn.profile.RefreshWorker
import cloud.oneoh.oneboxn.rules.FileRuleStorage
import cloud.oneoh.oneboxn.update.AppUpdater
import cloud.oneoh.oneboxn.update.createAppUpdater
import cloud.oneoh.oneboxn.usage.UsageReader
import cloud.oneoh.oneboxn.vpn.TunnelClient
import cloud.oneoh.oneboxn.vpn.TunnelController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// Application 即依赖持有者：lazy val 手动构造注入（无 Container 类、无 Hilt）。
//
// 双进程：本 Application 在 UI 与 :tun 两进程各实例化一次。
// 隧道进程侧的 EngineBinding 由 TunnelService 自行构造（持 TunHost）；此处只装配 UI 进程用到的依赖
// （前台回调只在 UI 进程有 Activity 时触发，:tun 进程不会触碰 actions）。
// 换核只改绑定文件与 engine/ 管线，本装配与契约消费方零改动。
class App : Application() {
    // UI 进程侧观察：经 :tun 的 MonitorService 拉流量/分组/日志，本进程不加载引擎原生库。
    private val monitor: MonitorBinding by lazy { MonitorBinding(this) }

    // 日志唯一缓冲：ENGINE（TunnelClient）与 APP（TunnelController/AppActions）汇于此。
    val logStore by lazy { LogStore() }

    // 引擎版本唯一读取口：构建期从 engine/Makefile 注入，UI 进程读它不触引擎原生库。
    val engineVersion: String = BuildConfig.ENGINE_VERSION

    /** 引擎自陈：上游库只自陈版本，条目留空——不编造字段。 */
    val engineInfo: EngineInfo by lazy { EngineInfo.of(name = ENGINE_NAME, version = engineVersion, entries = emptyList()) }

    // refreshDirectDns 引用 lazy actions 属运行期求值（启动必先经 actions 发起），无构造环；
    // 显式类型断开 controller ↔ actions 两个 lazy 的类型推断递归。
    private val tunnelController: TunnelController by lazy {
        TunnelController(
            this,
            ::compileConfig,
            logStore,
            refreshDirectDns = { actions.refreshDirectDns() },
            // 失败诊断第 1 级：隧道进程写下的真因，经中立契约取。
            tunnelDiagnosis = { monitor.lastError() },
        )
    }
    private val tunnelClient by lazy { TunnelClient(monitor, logStore) }

    private val dataRepository by lazy {
        AppDataRepository(
            profileStorage = FileProfileStorage(filesDir),
            ruleStorage = FileRuleStorage(filesDir),
            onFirstLoad = { profiles, rules ->
                LegacyDataImport(this, getSharedPreferences("preferences", MODE_PRIVATE), routingModeStore)
                    .run(profiles, rules)
            },
        )
    }
    private val configCompiler by lazy {
        ConfigCompiler(
            dataRepository = dataRepository,
            templateSource = ConfigTemplateSource { mode -> TemplateAssets.load(assets, mode) },
        )
    }
    private val routingModeStore by lazy {
        RoutingModeStore(getSharedPreferences("preferences", MODE_PRIVATE))
    }
    private val regionStore by lazy {
        RegionStore(getSharedPreferences("preferences", MODE_PRIVATE))
    }
    private val configFetcher by lazy { HttpConfigFetcher() }
    /** 对外请求的唯一 UA 来源：配置抓取与更新检查共用。 */
    val userAgent: () -> String = { UserAgent.build(engineVersion) }
    private val devPreferences by lazy {
        DevPreferences(getSharedPreferences("preferences", MODE_PRIVATE))
    }
    private val refreshRecords by lazy {
        RefreshRecordStore(FileRefreshRecordStorage(filesDir))
    }

    /** 更新检查：实现在商店渠道的源集里。 */
    val updater: AppUpdater by lazy { createAppUpdater(this) }

    // 应用级作用域：承载 AppActions 观察流的合并（进程存活期常驻，不取消）。
    private val actionScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // UI 与开发期 harness 共用的动作层（消费方唯一入口，见 AppActions）。
    val actions: AppActions by lazy {
        AppActions(
            controller = tunnelController,
            client = tunnelClient,
            dataRepository = dataRepository,
            modeStore = routingModeStore,
            regionStore = regionStore,
            logStore = logStore,
            fetcher = configFetcher,
            userAgent = userAgent,
            usageReader = UsageReader(this),
            debugConfigUrl = BuildConfig.CONFIG_URL,
            devPreferences = devPreferences,
            acceleratorBase = BuildConfig.ACCELERATE_URL,
            refreshRecords = refreshRecords,
            scope = actionScope,
            onBackgroundRefreshChanged = { enabled -> RefreshWorker.sync(this, enabled) },
        )
    }

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(foregroundSignal)
        // 启动即按开关状态注册或注销周期任务。只在 UI 进程做——`:tun` 也会走 onCreate，
        // 在那边碰 WorkManager 等于把整套调度器装进一个本该只跑引擎的进程。
        // 测试宿主一律不碰排期。**本端比 Apple 更要紧**——那边的 XPC 活动止于那一次
        // 测试运行，而这里排进的是 WorkManager 的**持久化**数据库，跨进程死亡与重启存活。
        val launch = RefreshWorker.launchContext(
            processName = getProcessName(),
            packageName = packageName,
            runner = RefreshWorker.instrumentationRunner(),
        )
        if (RefreshWorker.shouldTouchSchedule(launch)) {
            RefreshWorker.sync(this, devPreferences.backgroundRefresh())
            updater.scheduleChecks()
        }
    }

    /**
     * 合并装配：启动路径与查看页 Merged 共用，
     * 唯一合并调用处在 ConfigCompiler；文件快照、模板读取和 JSON 合并均不占主线程。
     * 导入原文 = 激活 profile 的原始响应体（无激活或为空 → 合并期 MergeError → 启动失败诊断）；
     * 日志级别偏好固定默认 `info`；直连 DNS = 启动前探测胜者
     * （未探测过或零响应为空 → 由合并侧回落取值）。
     */
    private suspend fun compileConfig(): CompiledStart = configCompiler.compile(
        ConfigCompileRequest(
            mode = routingModeStore.get(),
            directDns = actions.directDns.value.orEmpty(),
        ),
    )

    // 节点测速触发三（回前台）：以「started Activity 计数 0→1」为前台上升沿，
    // 免引 lifecycle-process 依赖；触发单点在 AppActions（未连接时空操作）。
    // 观察闸门共用同一计数：上升沿重注册观察客户端（先于重测，快照即刻回放），
    // 下降沿注销——后台期 MonitorService 对零客户端短路，不再向可冻结进程投递。
    private var startedActivities = 0
    private val mutableUiForeground = MutableStateFlow(false)

    /**
     * 界面是否在前台。进程不一定由用户拉起——自更新装完后系统安装器的回执会在后台起一个新进程，
     * 那时系统可能限制后台联网：要联网又不急的事等它为真再做。
     */
    val uiForeground: StateFlow<Boolean> = mutableUiForeground.asStateFlow()

    private val foregroundSignal = object : ActivityLifecycleCallbacks {
        override fun onActivityStarted(activity: Activity) {
            if (startedActivities == 0) {
                monitor.setUiForeground(UiForegroundState.FOREGROUND)
                mutableUiForeground.value = true
                actions.appForegrounded()
            }
            startedActivities++
        }

        override fun onActivityStopped(activity: Activity) {
            startedActivities--
            if (startedActivities == 0) {
                monitor.setUiForeground(UiForegroundState.BACKGROUND)
                mutableUiForeground.value = false
            }
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityResumed(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}

/** 设置页与引擎信息页呈现的引擎名：中立名，不写上游品牌。 */
private const val ENGINE_NAME = "default"

/** ViewModel 工厂从 CreationExtras 取到 App，用于手动构造注入依赖。 */
val CreationExtras.app: App
    get() = this[APPLICATION_KEY] as App
