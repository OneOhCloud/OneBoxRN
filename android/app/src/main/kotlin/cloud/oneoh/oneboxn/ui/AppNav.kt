package cloud.oneoh.oneboxn.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.FailureSource
import cloud.oneoh.oneboxn.core.ImportLink
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.LinkVerdict
import cloud.oneoh.oneboxn.ui.components.FailureSheet
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.update.AppUpdater

// 根导航：三 tab 各自保留独立状态与栈（切 tab 不丢导航位置）。纯状态导航，不引入 Navigation 库；
// 与 iOS App/UI/AppNav.swift 同名异实现（TabView+NavigationStack ↔ Scaffold+NavigationBar）。
enum class AppTab { HOME, PROFILES, SETTINGS }

enum class SettingsRoute {
    RULES, DIAGNOSTICS, ADVANCED, LOGS, CONFIG, STATS, USAGE, DEV,
    REFRESH_RECORDS, ENGINE_INFO,
}

/**
 * 切根时新屏的上移量。
 *
 * 不进 `Theme.Spacing`：那一族是版式间距，而这是一个动效位移量——
 * 放进去会让间距表多出一个从不用于间距的值，下一个人按名字取它就取错了。
 */
private val TAB_SWAP_RISE = 5.dp

@Composable
fun AppNav(
    actions: AppActions,
    updater: AppUpdater,
    deepLink: String?,
    onDeepLinkConsumed: () -> Unit,
    homeTabRequested: Boolean,
    onHomeTabRequestConsumed: () -> Unit,
) {
    val dataLoaded by actions.dataLoaded.collectAsStateWithLifecycle()
    val activeProfile by actions.activeProfile.collectAsStateWithLifecycle()
    if (!shouldShowAppContent(dataLoaded)) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    var tab by rememberSaveable { mutableStateOf(AppTab.HOME) }
    // 首页入口的仪表读连接态：与电源砖读同一个首页状态（同一个 ViewModel 实例），两处不会各自漂移。
    val homeVm: HomeViewModel = viewModel { HomeViewModel(actions) }

    // 深链注入通道：原串直传唯一解析器（本层零解析分支）。
    // 接受 → 携真实载荷进导入页；拒绝 → 空 url 载荷 = 「导入页默认态」的最简表达（非错误视图，镜像 iOS AppNav.onOpenURL）。
    // 消费一次性由 HomeScreen 推入路由后回调 onDeepLinkConsumed 清空保证。
    val pendingImport = deepLink?.let { raw ->
        when (val verdict = ImportLink.parse(raw)) {
            is LinkVerdict.Accepted -> verdict.payload
            is LinkVerdict.Rejected -> ImportPayload(url = "", requestedApply = false)
        }
    }
    LaunchedEffect(pendingImport) {
        if (pendingImport != null) tab = AppTab.HOME
    }
    // 磁贴长按：从 App 外面进来的入口落主页，不接着上次停留的 tab。
    // 设置栈不清——切 tab 本就保留各自的栈（镜像 iOS TabView），长按不该比切 tab 更暴力。
    LaunchedEffect(homeTabRequested) {
        if (homeTabRequested) {
            tab = AppTab.HOME
            onHomeTabRequestConsumed()
        }
    }
    var settingsPath by rememberSaveable(stateSaver = SettingsPathSaver) {
        mutableStateOf(emptyList())
    }
    val stateHolder = rememberSaveableStateHolder()

    // 全局失败弹层通道——挂载在根导航层观察动作层 lastError，由空变非空即弹（弹出附 error 触感）。
    // 挂载时已有的失败作基线不弹（首页失败态另行持续呈现，与本弹层互不代替）。
    var failure by remember { mutableStateOf<StartFailurePresentation?>(null) }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(actions) {
        var previous = actions.failure.value
        actions.failure.collect { diagnostic ->
            if (previous == null && diagnostic != null) {
                haptics.performHapticFeedback(HapticFeedbackType.Reject)
                // 时刻取自同一个诊断值而非另一条流：并列两条流在这一拍可能还没跟上，
                // 而这里的快照此后定格，取到 null 就把在线失败永久显示成「—」。
                // 指纹在转变的这一刻取，之后用户改配置也不影响这次诊断。
                failure = StartFailurePresentation(
                    error = diagnostic.error,
                    occurredAtMillis = diagnostic.occurredAtMillis,
                    configFingerprint = actions.startConfigFingerprint,
                    // 来源与诊断同源同拍：它随 `FailureDiagnostic` 一起定格，理由同上面的时刻。
                    source = diagnostic.source,
                )
            }
            previous = diagnostic
        }
    }

    // 返回键弹 settings 栈顶；栈空时交系统默认（退出）。back 不切 tab（镜像 iOS TabView 语义）。
    BackHandler(enabled = tab == AppTab.SETTINGS && settingsPath.isNotEmpty()) {
        settingsPath = settingsPath.dropLast(1)
    }

    // inset 单一归属：外层 Scaffold 只管底部 tab 栏（顶部 inset 置零），顶部 inset 由各屏自持——
    // 有顶栏的屏归其 TopAppBar，无顶栏的 Home 自补 statusBarsPadding；消费已垫付的 padding，
    // 防止内层 Scaffold 对同一 inset 二次留白。
    Scaffold(
        containerColor = Theme.colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            // 底部 dock：用原生 NavigationBar，但必须把容器色设为 surface、tonal 海拔归零、
            // 不画分隔线（层级不靠线条建立）。
            NavigationBar(
                containerColor = Theme.colors.surface,
                contentColor = Theme.colors.textSecondary,
                tonalElevation = 0.dp,
            ) {
                for (entry in TAB_ENTRIES) {
                    NavigationBarItem(
                        selected = tab == entry.tab,
                        // 再点当前 tab = 回到该 tab 的根；切换到别的 tab 时不清栈（各 tab 各记自己的深度）。
                        // 只有 SETTINGS 有栈；HOME / PROFILES 无子路由，故这里只清 `settingsPath`。
                        // 新增 tab 带栈时要在这里补一支——否则那一支会静默地没有这个行为。
                        onClick = {
                            if (tab == entry.tab) {
                                if (entry.tab == AppTab.SETTINGS) settingsPath = emptyList()
                            } else {
                                tab = entry.tab
                            }
                        },
                        icon = {
                            Icon(painterResource(entry.tab.icon(current = tab, connection = homeVm.heroState)), contentDescription = null)
                        },
                        label = { Text(stringResource(entry.label), style = Theme.Type.badge) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Theme.colors.accent,
                            selectedTextColor = Theme.colors.accent,
                            unselectedIconColor = Theme.colors.textSecondary,
                            unselectedTextColor = Theme.colors.textSecondary,
                            indicatorColor = Theme.colors.accentContainer,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            // 切根过渡（透明度 + `5` 上移，`300ms`），形状取自 UI 参考实现：
            // 新屏 `opacity 0 → 1` 且 `translateY(5px) → 0`，旧屏不做退场动画——
            // 对应 `ExitTransition.None`，不是交叉淡化（那会让两屏同时在场）。
            //
            // `SizeTransform(clip = false)`：三个根同宽高，尺寸本就不变；带 `clip` 时
            // 过渡期间内容会被裁到动画中的盒子里。
            //
            // 内容读的是 `current` 而不是外层的 `tab`：读外层那个，两个 pane 会同时画成新屏，
            // 而屏上只是「过渡没生效」，不会报错。
            //
            // 减少动态由 `motionSpec` 统一退化成 `snap()`。三个值都在这里取，不在 `transitionSpec` 里：
            // 那个闭包不是 @Composable 作用域（`motionSpec` 是 @Composable，`roundToPx` 要 `Density`）。
            val pageFade = motionSpec<Float>(Motion.PAGE_MS)
            val pageSlide = motionSpec<IntOffset>(Motion.PAGE_MS)
            val risePx = with(LocalDensity.current) { TAB_SWAP_RISE.roundToPx() }
            AnimatedContent(
                targetState = tab,
                transitionSpec = {
                    (fadeIn(pageFade) + slideInVertically(pageSlide) { risePx }) togetherWith
                        ExitTransition.None using SizeTransform(clip = false)
                },
                label = "tabSwap",
            ) { current ->
                when (current) {
                    AppTab.HOME -> stateHolder.SaveableStateProvider("tab/home") {
                        HomeScreen(
                            actions = actions,
                            pendingImport = pendingImport,
                            onPendingImportConsumed = onDeepLinkConsumed,
                        )
                    }
                    AppTab.PROFILES -> stateHolder.SaveableStateProvider("tab/profiles") {
                        ProfilesScreen(actions = actions, onShowHome = { tab = AppTab.HOME })
                    }
                    AppTab.SETTINGS -> stateHolder.SaveableStateProvider("tab/settings") {
                        when (settingsPath.lastOrNull()) {
                            null -> stateHolder.SaveableStateProvider("settings/root") {
                                SettingsScreen(updater = updater, open = { settingsPath = settingsPath + it })
                            }
                            SettingsRoute.RULES -> stateHolder.SaveableStateProvider("settings/rules") {
                                RulesScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                            SettingsRoute.DIAGNOSTICS -> stateHolder.SaveableStateProvider("settings/diagnostics") {
                                DiagnosticsScreen(
                                    // 无激活配置 ⇒ 本机用量行禁用。可用性判在这里，因为激活配置这个状态只有这一层知道。
                                    usage = if (activeProfile == null) {
                                        RowInteraction.Disabled
                                    } else {
                                        RowInteraction.Clickable { settingsPath = settingsPath + SettingsRoute.USAGE }
                                    },
                                    onBack = { settingsPath = settingsPath.dropLast(1) },
                                    open = { settingsPath = settingsPath + it },
                                )
                            }
                            SettingsRoute.ADVANCED -> stateHolder.SaveableStateProvider("settings/advanced") {
                                AdvancedSettingsScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                            SettingsRoute.LOGS -> stateHolder.SaveableStateProvider("settings/logs") {
                                LogsScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                            SettingsRoute.CONFIG -> stateHolder.SaveableStateProvider("settings/config") {
                                ConfigScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                            SettingsRoute.STATS -> stateHolder.SaveableStateProvider("settings/stats") {
                                StatsScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                            // 本机用量读的是激活配置的账本。进得来就一定有激活配置：入口那一行在
                            // `activeProfile == null` 时是 `RowInteraction.Disabled`（见上面 `DIAGNOSTICS` 那一支），点不动。
                            // 故这里 `requireNotNull`——拿不到就是入口那道门漏了，崩掉暴露；不回落成 `orEmpty()`：
                            // 那会画出一张标题是空串的空态页，与「这个配置确实没有账本」在屏上无法区分。
                            SettingsRoute.USAGE -> stateHolder.SaveableStateProvider("settings/usage") {
                                val profile = requireNotNull(activeProfile) {
                                    "usage route reached without an active profile"
                                }
                                UsageScreen(
                                    profileId = profile.id,
                                    profileName = profile.name,
                                    onBack = { settingsPath = settingsPath.dropLast(1) },
                                )
                            }
                            // 入口是版本页脚连点，不在任何可见导航里；任务详情是弹层不是路由
                            // （SettingsPathSaver 按 enum name 存栈，带载荷的路由要逼它改编码）。
                            SettingsRoute.DEV -> stateHolder.SaveableStateProvider("settings/dev") {
                                DevScreen(
                                    onBack = { settingsPath = settingsPath.dropLast(1) },
                                    onOpenRecords = { settingsPath = settingsPath + SettingsRoute.REFRESH_RECORDS },
                                    onOpenEngineInfo = { settingsPath = settingsPath + SettingsRoute.ENGINE_INFO },
                                )
                            }
                            SettingsRoute.REFRESH_RECORDS -> stateHolder.SaveableStateProvider("settings/refresh-records") {
                                RefreshRecordsScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                            SettingsRoute.ENGINE_INFO -> stateHolder.SaveableStateProvider("settings/engine-info") {
                                EngineInfoScreen(onBack = { settingsPath = settingsPath.dropLast(1) })
                            }
                        }
                    }
                }
            }
        }
    }

    failure?.let { presentation ->
        FailureSheet(
            error = presentation.error,
            occurredAtMillis = presentation.occurredAtMillis,
            configFingerprint = presentation.configFingerprint,
            source = presentation.source,
            onDismiss = { failure = null },
        )
    }
}

/** dock 三项：图标 + 10–11/600 标签，等宽，颜色之外另有选中块这条状态通道。 */
private data class TabEntry(val tab: AppTab, val label: Int)

private val TAB_ENTRIES = listOf(
    TabEntry(AppTab.HOME, R.string.tab_home),
    TabEntry(AppTab.PROFILES, R.string.tab_profiles),
    TabEntry(AppTab.SETTINGS, R.string.tab_settings),
)

/**
 * 三个入口的字形：主页是一枚随连接态走的仪表，配置是调色板（选中换实心版），设置是齿轮。
 * 仪表与齿轮没有实心版，这两个入口的选中只靠导航栏的选中块。
 */
internal fun AppTab.icon(current: AppTab, connection: HomeViewModel.HeroState): Int = when (this) {
    AppTab.HOME -> homeGauge(connection)
    AppTab.PROFILES -> if (current == AppTab.PROFILES) R.drawable.ic_tab_profiles_selected else R.drawable.ic_tab_profiles
    AppTab.SETTINGS -> R.drawable.ic_tab_settings
}

/** 五态收敛与电源砖一致：失败态读作「没连上」，断开中与连接中同是「指针在半路」。 */
private fun homeGauge(connection: HomeViewModel.HeroState): Int = when (connection) {
    HomeViewModel.HeroState.DISCONNECTED, HomeViewModel.HeroState.START_FAILED -> R.drawable.ic_tab_home_idle
    HomeViewModel.HeroState.CONNECTING, HomeViewModel.HeroState.DISCONNECTING -> R.drawable.ic_tab_home_connecting
    HomeViewModel.HeroState.CONNECTED -> R.drawable.ic_tab_home_connected
}

// 失败弹层载荷：失败发生那一刻的诊断快照（镜像 iOS AppNav 的 StartFailurePresentation）。
private data class StartFailurePresentation(
    val error: EngineError,
    val occurredAtMillis: Long?,
    val configFingerprint: String?,
    val source: FailureSource?,
)

internal fun shouldShowAppContent(dataLoaded: Boolean): Boolean = dataLoaded

// rememberSaveable 需要可保存类型：settings 栈存为路由名列表；未知键即崩溃（fail-fast）。
private val SettingsPathSaver = Saver<List<SettingsRoute>, ArrayList<String>>(
    save = { ArrayList(it.map(SettingsRoute::name)) },
    restore = { saved -> saved.map(SettingsRoute::valueOf) },
)
