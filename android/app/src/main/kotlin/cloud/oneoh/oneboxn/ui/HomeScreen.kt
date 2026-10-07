package cloud.oneoh.oneboxn.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.BuildConfig
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.ui.components.ConnectHero
import cloud.oneoh.oneboxn.ui.components.ConnectPhase
import cloud.oneoh.oneboxn.ui.components.ConnectStatusRow
import cloud.oneoh.oneboxn.ui.components.FailureSheet
import cloud.oneoh.oneboxn.ui.components.GapColumn
import cloud.oneoh.oneboxn.ui.components.GapColumnRules
import cloud.oneoh.oneboxn.ui.components.GapRule
import cloud.oneoh.oneboxn.ui.components.HeroAction
import cloud.oneoh.oneboxn.ui.components.HeroGeometry
import cloud.oneoh.oneboxn.ui.components.HeroGlyph
import cloud.oneoh.oneboxn.ui.components.HomeEntryCard
import cloud.oneoh.oneboxn.ui.components.HomeEntryContent
import cloud.oneoh.oneboxn.ui.components.ImportSheet
import cloud.oneoh.oneboxn.ui.components.MenuOptionState
import cloud.oneoh.oneboxn.ui.components.NodeChoices
import cloud.oneoh.oneboxn.ui.components.NodeSheet
import cloud.oneoh.oneboxn.ui.components.ProfileSummaryCard
import cloud.oneoh.oneboxn.ui.components.SelectionRow
import cloud.oneoh.oneboxn.ui.components.SelectionSheet
import cloud.oneoh.oneboxn.ui.components.SessionCard
import cloud.oneoh.oneboxn.ui.components.SessionReadings
import cloud.oneoh.oneboxn.ui.components.SummaryCardBody
import com.microsoft.fluent.mobile.icons.R as FluentR
import java.util.UUID

// Home 自持栈的目的地（镜像 iOS HomeRoute）。ImportFlow 的 entryId 标识一次进入：
// 作导入页 ViewModelStore 作用域——同一条目（含转屏重建）复用相位不重放，新条目必得新流水线，
// 对齐 iOS 每次推入新建 VM 的语义（深链冷/热启动一致的前提）。
sealed interface HomeRoute {
    data class ImportFlow(
        val payload: ImportPayload,
        val entryId: String = UUID.randomUUID().toString(),
    ) : HomeRoute

    data object Scan : HomeRoute
}

// 首页：整页只回答一件事——连没连上。
// 舞台（电源砖 → 状态行）· 组位（配置卡 / 会话卡 / 失败卡三张叠放）。
// 页面没有顶栏也没有页面标题：电源砖本身就是标题。
// 自持栈：导入流程 / 扫码在本 tab 栈内推入。

/**
 * 首页是唯一取 `20` 页边距的页面（对位 OneBox 的 `px-5`），配置页与设置页仍是 `16`。
 * `20` 是有意的派生例外，**不要把它吸附回 `Spacing.lg`**。
 */
private val PAGE_HORIZONTAL_PADDING = 20.dp

/** 顶部留白。 */
private val CONTENT_TOP_PADDING = 20.dp

/**
 * 页底留白（内容底部留白 = dock 高 + 12）。
 *
 * 这里只出那个 `12`：Android 的 dock 是原生 `NavigationBar`、不浮起，外层 Scaffold 已经把
 * 它那份高度垫进内容 padding 里（见 AppNav），再加一次就会在底下空出两倍。
 */
private val CONTENT_BOTTOM_PADDING = 12.dp

/** 舞台与组位之间的定距：宽到卡读不成状态行的下一行，窄到卡仍和电源砖同属一组。 */
private val STAGE_TO_GROUP = 128.dp

/** 按 2 : 3 分完组外余量之后，整组再下移的定量（取自底缝）。 */
private val GROUP_DROP = 24.dp

/**
 * 三条缝：顶缝（顶内衬之下）· 舞台与组位之间 · 组位与 dock 之间（与 iOS `HomeLayout.gaps` 同值）。
 *
 * 舞台与组位是一组，组内距离钉在 [STAGE_TO_GROUP]，不随屏高、也不随电源砖档位伸缩：
 * 这条缝一分余量，高屏上它就比卡还宽，卡在视觉上离开舞台、归到 dock 那一侧。
 * 屏高带来的余量只进组外，顶 : 底 = `2 : 3`，整组重心略高于列的正中；分完再整组下移 [GROUP_DROP]。
 * 底缝下限 `16`：矮屏上卡也不贴 dock。
 */
internal val HOME_COLUMN = GapColumnRules(
    gaps = listOf(
        GapRule(minimum = 0.dp, weight = 2f),
        GapRule(minimum = STAGE_TO_GROUP, weight = 0f),
        GapRule(minimum = Theme.Spacing.lg, weight = 3f),
    ),
    drop = GROUP_DROP,
)

/**
 * 电源砖按列高分档（与 iOS `HomeLayout.heroTiers` 同值）：手机上 `160` 撑不起舞台，基础档 `184`；
 * 列高够的屏上 `184` 仍在大片留白里显得小，再升一档。按列高而不是机型判：分档要回答的是「这一列有多高」。
 */
internal val HOME_HERO_TIERS = HeroTiers(
    base = 184.dp,
    upgrades = listOf(HeroTiers.Upgrade(minimumColumnHeight = 740.dp, tileSide = 208.dp)),
)

/** 电源砖分档：列高够不到任何升档门槛时取 [base]，否则取够得着的最高一档。 */
@Immutable
internal data class HeroTiers(val base: Dp, val upgrades: List<Upgrade>) {
    @Immutable
    data class Upgrade(val minimumColumnHeight: Dp, val tileSide: Dp)

    init {
        require(upgrades.zipWithNext().all { (lower, upper) -> lower.minimumColumnHeight < upper.minimumColumnHeight }) {
            "升档表必须按列高升序"
        }
    }

    /** 任何列高都有一档砖：视口极矮时列高是负的。 */
    fun tileSide(columnHeight: Dp): Dp =
        upgrades.lastOrNull { columnHeight >= it.minimumColumnHeight }?.tileSide ?: base
}

@Composable
fun HomeScreen(
    actions: AppActions,
    pendingImport: ImportPayload?,
    onPendingImportConsumed: () -> Unit,
) {
    val importViewModels: ImportViewModelStoreRegistry = viewModel()
    var stack by rememberSaveable(stateSaver = HomeStackSaver) { mutableStateOf(emptyList()) }

    fun popRoute() {
        (stack.lastOrNull() as? HomeRoute.ImportFlow)?.let { importViewModels.remove(it.entryId) }
        stack = stack.dropLast(1)
    }

    fun leaveImportFlow() {
        stack.filterIsInstance<HomeRoute.ImportFlow>().forEach { importViewModels.remove(it.entryId) }
        stack = emptyList()
    }

    BackHandler(enabled = stack.isNotEmpty(), onBack = ::popRoute)

    // 深链载荷唯一消费点：推入导入页路由后立即回调清空，一次性语义阻断重建重放。
    LaunchedEffect(pendingImport) {
        if (pendingImport != null) {
            stack = stack + HomeRoute.ImportFlow(pendingImport)
            onPendingImportConsumed()
        }
    }

    when (val top = stack.lastOrNull()) {
        is HomeRoute.ImportFlow -> ImportScreen(
            actions = actions,
            payload = top.payload,
            viewModelStoreOwner = importViewModels.ownerFor(top.entryId),
            // 本来就在首页 tab：「连接后回首页」就是清掉导入栈。
            exits = ImportExits(done = ::leaveImportFlow, back = ::popRoute, showHome = ::leaveImportFlow),
        )
        HomeRoute.Scan -> ScanScreen(
            // 扫码接受分支：识别载荷直进导入流程（payload 已经 ImportLink.parse 判定）。
            onRecognized = { payload -> stack = stack + HomeRoute.ImportFlow(payload) },
            onBack = ::popRoute,
        )
        null -> HomeContent(
            actions = actions,
            onOpenImportFlow = { payload -> stack = stack + HomeRoute.ImportFlow(payload) },
            onOpenScan = { stack = stack + HomeRoute.Scan },
        )
    }
}

@Composable
private fun HomeContent(
    actions: AppActions,
    onOpenImportFlow: (ImportPayload) -> Unit,
    onOpenScan: () -> Unit,
) {
    val vm: HomeViewModel = viewModel { HomeViewModel(actions) }
    // 与配置页同一个实例（同在 Activity 作用域）：切换走它的 activate，「已是当前项、正在刷新的那一份不切」只有这一份守卫。
    val profiles: ProfilesViewModel = viewModel { ProfilesViewModel(actions) }
    var showImportSheet by remember { mutableStateOf(false) }
    var showFailureSheet by remember { mutableStateOf(false) }
    var showNodeSheet by remember { mutableStateOf(false) }
    var showProfileSheet by remember { mutableStateOf(false) }
    var showPermissionAlert by remember { mutableStateOf(false) }

    val connect = connectAction(start = vm::connect, onPermissionDenied = { showPermissionAlert = true })

    // 无顶栏屏自持顶部 inset（外层 Scaffold 顶部 inset 已置零，见 AppNav）。
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .screenBackground(vm.heroState.pageTint())
            .statusBarsPadding(),
    ) {
        // 列高 = 视口减去上下内衬，与 iOS 的「视口 − 壳那一档 − 顶内衬」同一列。
        val hero = HeroGeometry(
            HOME_HERO_TIERS.tileSide(maxHeight - CONTENT_TOP_PADDING - CONTENT_BOTTOM_PADDING),
        )
        // 两项只取自身高度，其余全部归三条缝，怎么分见 `HOME_COLUMN`。
        // 有无配置是同一列、同一余量规则：导入之后砖原地换回电源符号，不跳。
        //
        // `heightIn(min = maxHeight)` 是余量分配能工作的前提：滚动容器给的最大高是无穷，
        // 不把最小高钉在视口上，列高就等于内容高，**没有自由空间可分，各条缝静默塌到下限**。
        GapColumn(
            rules = HOME_COLUMN,
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .readableContentWidth()
                .padding(horizontal = PAGE_HORIZONTAL_PADDING)
                .padding(top = CONTENT_TOP_PADDING, bottom = CONTENT_BOTTOM_PADDING),
        ) {
            HomeStage(vm = vm, hero = hero, connect = connect, onImport = { showImportSheet = true })
            HomeGroupSlot(
                current = vm.group,
                cards = HomeGroupCards(profile = profiles.activeProfile, session = sessionReadings(vm)),
                actions = HomeGroupActions(
                    profileBody = profileCardBody(profiles.profiles.size) { showProfileSheet = true },
                    selectNode = { showNodeSheet = true },
                    showFailure = { showFailureSheet = true },
                ),
            )
        }
    }

    if (showImportSheet) {
        ImportSheet(
            onSubmit = onOpenImportFlow,
            onScan = onOpenScan,
            onDismiss = { showImportSheet = false },
        )
    }
    if (showFailureSheet) {
        vm.failure?.let { diagnostic ->
            FailureSheet(
                error = diagnostic.error,
                occurredAtMillis = diagnostic.occurredAtMillis,
                configFingerprint = vm.startConfigFingerprint,
                source = diagnostic.source,
                onDismiss = { showFailureSheet = false },
            )
        }
    }
    if (showNodeSheet) {
        NodeSheet(
            choices = NodeChoices(
                nodes = vm.selection.nodes,
                autoResolved = vm.selection.autoResolved,
                selected = vm.selectedNode,
                latencyTesting = vm.latencyTesting,
            ),
            onSelect = vm::selectNode,
            onDismiss = { showNodeSheet = false },
        )
    }
    if (showProfileSheet) {
        ProfileSwitchSheet(profiles = profiles, onDismiss = { showProfileSheet = false })
    }
    if (showPermissionAlert) {
        // 授权被拒 → 权限 Alert，不进入启动（用户选择而非错误）。
        AlertDialog(
            onDismissRequest = { showPermissionAlert = false },
            title = { Text(stringResource(R.string.home_vpn_permission_title)) },
            text = { Text(stringResource(R.string.home_vpn_permission_message)) },
            confirmButton = {
                TextButton(onClick = { showPermissionAlert = false }) {
                    Text(stringResource(R.string.ok))
                }
            },
        )
    }
}

/** 舞台：电源砖 → 16 → 状态行。回答「连没连上」。 */
@Composable
private fun HomeStage(vm: HomeViewModel, hero: HeroGeometry, connect: () -> Unit, onImport: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        if (vm.hasConfig) {
            val phase = vm.heroState.toConnectPhase()
            ConnectHero(
                phase = phase,
                geometry = hero,
                action = HeroAction(
                    accessibilityLabel = stringResource(
                        if (vm.connected) R.string.home_disconnect else R.string.home_connect,
                    ),
                    // loading 期间不可点。
                    onClick = if (vm.heroLoading) {
                        null
                    } else {
                        { if (vm.connected) vm.disconnect() else connect() }
                    },
                ),
            )
            Spacer(Modifier.height(Theme.Spacing.lg))
            ConnectStatusRow(phase = phase, text = connectStatusText(phase))
        } else {
            // 无配置时同一块砖换成导入入口，而不是一块禁用的电源砖：禁用的砖仍进读屏，
            // 看起来是一个点不动的启动按钮。砖自己的读屏标签已经是下面这一句，这一行只给眼睛看。
            val label = stringResource(R.string.home_empty_import)
            ConnectHero(
                phase = ConnectPhase.IDLE,
                geometry = hero,
                action = HeroAction(accessibilityLabel = label, onClick = onImport, glyph = HeroGlyph.ImportConfig),
            )
            Spacer(Modifier.height(Theme.Spacing.lg))
            Text(
                text = label,
                style = Theme.Type.heroStatus,
                color = Theme.colors.textSecondary,
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
    }
}

/** 会话卡的全部读数。节点名的本地化段在这里取，判定在 [NodeNameLines]。 */
@Composable
private fun sessionReadings(vm: HomeViewModel): SessionReadings = SessionReadings(
    // 还没有选中值时说「节点」，不留一段空白。
    node = if (vm.selectedNode.isEmpty()) {
        NodeNameLines(name = stringResource(R.string.nodes_title), autoCaption = null)
    } else {
        nodeNameLines(vm.selectedNode, vm.selection.autoResolved)
    },
    latency = vm.selectedLatency,
    downloadRate = vm.downloadRate,
    uploadRate = vm.uploadRate,
    usage = vm.sessionUsage,
    startedAt = vm.sessionStartedAt,
)

/**
 * 切换配置：与节点选择同一副选择弹层，列出全部配置，选中即设为当前配置。
 * 行与配置页列表行说同一件事（名称 + 用量），行尾是到期，选中态由弹层统一画。
 */
@Composable
private fun ProfileSwitchSheet(profiles: ProfilesViewModel, onDismiss: () -> Unit) {
    val activeId = profiles.activeProfile?.id
    val now = System.currentTimeMillis() / MILLIS_PER_SECOND
    SelectionSheet(
        title = stringResource(R.string.tab_profiles),
        options = profiles.profiles,
        optionKey = { it.id },
        optionRow = { profile ->
            SelectionRow(
                title = profile.name,
                subtitle = profileUsageOf(profile),
                state = if (profile.id == activeId) MenuOptionState.Chosen else MenuOptionState.Plain,
                trailing = { surface -> ProfileExpiryTrail(profile, now, surface) },
            )
        },
        onSelect = { profile -> profiles.activate(profile.id) },
        onDismiss = onDismiss,
    )
}

/**
 * 配置行尾的到期读数，与节点弹层的延迟同位：上一行日期 `12/500`，下一行天数 `11/400`，右对齐。
 * 即将到期、已到期在天数前配实心感叹圆；即将到期那一档只在颜色与图标里，读屏靠图标的描述说出来。
 */
@Composable
private fun ProfileExpiryTrail(profile: Profile, now: Long, surface: SecondaryTextSurface) {
    val trail = profileExpiryTrailOf(profile, now)
    val markInk = expiryInk(trail.emphasis, Theme.colors, Theme.tones)
    val remainderStyle = Theme.Type.note.tabular()
    Column(
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(EXPIRY_TRAIL_LINE_GAP),
        modifier = Modifier.widthIn(min = EXPIRY_TRAIL_MIN_WIDTH),
    ) {
        Text(
            text = trail.date,
            style = Theme.Type.subtitle.copy(fontWeight = FontWeight.Medium).tabular(),
            color = Theme.secondaryText(on = surface, colors = Theme.colors),
            maxLines = 1,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
        ) {
            if (trail.emphasis != ExpiryEmphasis.QUIET) {
                Icon(
                    painter = painterResource(FluentR.drawable.ic_fluent_error_circle_12_filled),
                    contentDescription = when (trail.emphasis) {
                        ExpiryEmphasis.WARNING -> stringResource(R.string.usage_expiring_soon)
                        // 已到期的字就是「已到期」，图标再读一遍是重复。
                        ExpiryEmphasis.ERROR, ExpiryEmphasis.QUIET -> null
                    },
                    tint = markInk,
                    modifier = Modifier.size(with(LocalDensity.current) { remainderStyle.fontSize.toDp() }),
                )
            }
            Text(
                text = trail.remaining,
                style = remainderStyle,
                color = expiryTextInk(markInk, surface, Theme.colors),
                maxLines = 1,
            )
        }
    }
}

/** 行尾到期那一列的最小宽：日期一行放得下，各行名称的截断点对齐；大字号时随字变宽，不截日期。 */
private val EXPIRY_TRAIL_MIN_WIDTH = 76.dp
private val EXPIRY_TRAIL_LINE_GAP = 2.dp

/** 组位三张卡各自要画的内容。没有当前配置只在无配置时出现，那时组位空着。 */
@Immutable
private data class HomeGroupCards(val profile: Profile?, val session: SessionReadings)

@Immutable
private data class HomeGroupActions(
    /** 配置卡的卡身：两份以上配置才点开切换（[profileCardBody]）。 */
    val profileBody: SummaryCardBody,
    val selectNode: () -> Unit,
    val showFailure: () -> Unit,
)

/**
 * 组位：配置卡 / 会话卡 / 失败卡三张叠放，谁在场由 [deriveHomeGroup] 决定；连接中与无配置时一张都不在。
 *
 * **叠放而不是 if/else 换卡**：三张始终参与求高，组位高恒定；组位一变，余量就重分，电源砖跟着上下跳。
 * 不在场的卡只量不摆——不摆放的节点不画、不可点、不进读屏，三条路一起退出，
 * 不必各自靠透明度、禁用与清语义去凑。
 */
@Composable
private fun HomeGroupSlot(current: HomeGroup?, cards: HomeGroupCards, actions: HomeGroupActions) {
    Layout(
        modifier = Modifier.fillMaxWidth(),
        content = {
            // 没有当前配置时占一个空位：仍是每种卡恰好一张，量高只由另外两张定。
            val profile = cards.profile
            if (profile == null) {
                Spacer(Modifier.layoutId(HomeGroup.PROFILE))
            } else {
                ProfileSummaryCard(
                    profile = profile,
                    productWebsite = BuildConfig.WEBSITE_URL,
                    body = actions.profileBody,
                    modifier = Modifier.layoutId(HomeGroup.PROFILE),
                )
            }
            SessionCard(
                readings = cards.session,
                onSelectNode = actions.selectNode,
                modifier = Modifier.layoutId(HomeGroup.SESSION),
            )
            HomeEntryCard(
                content = failureEntry(),
                onClick = actions.showFailure,
                modifier = Modifier.layoutId(HomeGroup.FAILURE_DETAILS),
            )
        },
    ) { measurables, constraints ->
        val placed = measurables.associate { it.layoutId as HomeGroup to it.measure(constraints.copy(minHeight = 0)) }
        check(placed.keys == HomeGroup.entries.toSet()) { "组位里每一种卡恰好一张" }
        layout(constraints.maxWidth, placed.values.maxOf { it.height }) {
            current?.let { placed.getValue(it).place(0, 0) }
        }
    }
}

@Composable
private fun failureEntry() = HomeEntryContent(
    icon = FluentR.drawable.ic_fluent_important_24_filled,
    tone = Theme.tones.error,
    title = stringResource(R.string.home_failure_title),
    titleColor = Theme.tones.error.fg,
    note = stringResource(R.string.home_failure_hint),
)

// rememberSaveable 需要可保存类型：栈存为字符串列表（import 携条目 id + apply 位 + url，
// id 保存使转屏重建复用同一 ViewModel 作用域而不重放流水线）；解码失败即崩溃（fail-fast）。
private val HomeStackSaver = Saver<List<HomeRoute>, ArrayList<String>>(
    save = { stack ->
        ArrayList(
            stack.map { route ->
                when (route) {
                    is HomeRoute.ImportFlow ->
                        "import|${route.entryId}|${if (route.payload.requestedApply) "1" else "0"}|${route.payload.url}"
                    HomeRoute.Scan -> "scan"
                }
            },
        )
    },
    restore = { saved ->
        saved.map { key ->
            when {
                key == "scan" -> HomeRoute.Scan
                key.startsWith("import|") -> {
                    val encoded = key.removePrefix("import|")
                    val entryId = encoded.substringBefore('|')
                    val rest = encoded.substringAfter('|')
                    val apply = rest.substringBefore('|')
                    val url = rest.substringAfter('|')
                    HomeRoute.ImportFlow(
                        payload = ImportPayload(url = url, requestedApply = apply == "1"),
                        entryId = entryId,
                    )
                }
                else -> error("unknown home route key: $key")
            }
        }
    },
)
