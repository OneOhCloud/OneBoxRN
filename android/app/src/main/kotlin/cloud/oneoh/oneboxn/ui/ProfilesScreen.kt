package cloud.oneoh.oneboxn.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.BuildConfig
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.ui.components.ImportSheet
import cloud.oneoh.oneboxn.ui.components.ProfileDeleteDialog
import cloud.oneoh.oneboxn.ui.components.ProfileDetailSheet
import cloud.oneoh.oneboxn.ui.components.ProfileImportRow
import cloud.oneoh.oneboxn.ui.components.ProfileRow
import cloud.oneoh.oneboxn.ui.components.ProfileRowHandlers
import cloud.oneoh.oneboxn.ui.components.ProfileSummaryCard
import cloud.oneoh.oneboxn.ui.components.SummaryCardBody
import com.microsoft.fluent.mobile.icons.R as FluentR
import java.util.UUID
import kotlinx.coroutines.flow.drop

// 配置页：当前配置摘要卡在上，可选择的配置列表在下。
// 摘要卡回答「还剩多少、哪天到期」，列表只管选择——点一行即切换，摘要卡跟着换内容、列表顺序不动。
// 自持栈承载导入 / 扫码 / 单份用量详情（镜像 iOS）。

/** 列表底部留白：Android 的 dock 高已由外层 Scaffold 垫付，这里只出那个 `12`。 */
private val LIST_BOTTOM_PADDING = 12.dp

@Composable
fun ProfilesScreen(actions: AppActions, onShowHome: () -> Unit) {
    val vm: ProfilesViewModel = viewModel { ProfilesViewModel(actions) }
    val importViewModels: ImportViewModelStoreRegistry = viewModel()
    var path by rememberSaveable(stateSaver = ProfilesPathSaver) {
        mutableStateOf(emptyList<ProfilesRoute>())
    }
    var showImportSheet by rememberSaveable { mutableStateOf(false) }
    var deleteCandidate by remember { mutableStateOf<Profile?>(null) }
    var detailCandidate by remember { mutableStateOf<Profile?>(null) }

    fun popRoute() {
        (path.lastOrNull() as? ProfilesRoute.ImportFlow)?.let { importViewModels.remove(it.entryId) }
        path = path.dropLast(1)
    }

    fun leaveImportFlow() {
        path.filterIsInstance<ProfilesRoute.ImportFlow>().forEach { importViewModels.remove(it.entryId) }
        path = emptyList()
    }

    BackHandler(enabled = path.isNotEmpty(), onBack = ::popRoute)

    when (val top = path.lastOrNull()) {
        null -> ProfilesRoot(
            vm = vm,
            requests = ProfilesRequests(
                onImport = { showImportSheet = true },
                onDelete = { deleteCandidate = it },
                onShowDetail = { detailCandidate = it },
                onOpenUsage = { profile -> path = path + ProfilesRoute.Usage(profile.id, profile.name) },
            ),
        )
        // 导入语义（按 URL upsert + 设激活）全在 core ImportFlow/ProfileStore；
        // entryId 作导入页 ViewModelStore 作用域——同条目重建复用相位，新条目必得新流水线。
        is ProfilesRoute.ImportFlow -> ImportScreen(
            actions = actions,
            payload = top.payload,
            viewModelStoreOwner = importViewModels.ownerFor(top.entryId),
            exits = ImportExits(
                done = ::leaveImportFlow,
                back = ::popRoute,
                showHome = {
                    leaveImportFlow()
                    onShowHome()
                },
            ),
        )
        // 扫码接受分支：识别载荷（含 requestedApply）原样直进导入流程。
        ProfilesRoute.Scan -> ScanScreen(
            onRecognized = { payload -> path = path + ProfilesRoute.ImportFlow(payload) },
            onBack = ::popRoute,
        )
        is ProfilesRoute.Usage -> UsageScreen(
            profileId = top.profileId,
            profileName = top.profileName,
            onBack = ::popRoute,
        )
    }

    if (showImportSheet) {
        ImportSheet(
            onSubmit = { payload -> path = path + ProfilesRoute.ImportFlow(payload) },
            onScan = { path = path + ProfilesRoute.Scan },
            onDismiss = { showImportSheet = false },
        )
    }

    detailCandidate?.let { opened ->
        // 产品官网与关于页「官网」行同一来源（构建期注入）。
        ProfileDetailSheet(
            vm = vm,
            opened = opened,
            productWebsite = BuildConfig.WEBSITE_URL,
            onDismiss = { detailCandidate = null },
        )
    }

    deleteCandidate?.let { candidate ->
        // 确认走 ProfileStore.remove（激活提升在 core）。
        ProfileDeleteDialog(
            profile = candidate,
            onConfirm = {
                vm.delete(candidate.id)
                deleteCandidate = null
            },
            onDismiss = { deleteCandidate = null },
        )
    }

    vm.refreshError?.let { error ->
        // 刷新失败 Alert 携错误信息（文案经 ImportErrorText 唯一映射，与导入失败视图共用）；
        // 确认清空错误。
        AlertDialog(
            onDismissRequest = vm::dismissRefreshError,
            title = { Text(stringResource(R.string.profiles_refresh_failed)) },
            text = { Text(importErrorAlertText(error)) },
            confirmButton = {
                TextButton(onClick = vm::dismissRefreshError) {
                    Text(stringResource(R.string.ok))
                }
            },
        )
    }
}

// Profiles 自持栈的目的地（镜像 iOS ProfilesScreen.Route；与 HomeRoute 同形但互不耦合）。
// ImportFlow 的 entryId 语义同 HomeRoute.ImportFlow：标识一次进入，同条目（含转屏重建）不重放流水线。
private sealed interface ProfilesRoute {
    data class ImportFlow(
        val payload: ImportPayload,
        val entryId: String = UUID.randomUUID().toString(),
    ) : ProfilesRoute

    data object Scan : ProfilesRoute

    /** 配置行尾的用量入口：本机用量页；名字随路由带走，页面本身只读账本。 */
    data class Usage(val profileId: String, val profileName: String) : ProfilesRoute
}

// rememberSaveable 需要可保存类型：路由编码为字符串（import 携条目 id + apply 位 + url）；
// 未知键即崩溃（fail-fast）。
private val ProfilesPathSaver = Saver<List<ProfilesRoute>, ArrayList<String>>(
    save = { stack ->
        ArrayList(
            stack.map { route ->
                when (route) {
                    is ProfilesRoute.ImportFlow ->
                        "import|${route.entryId}|${if (route.payload.requestedApply) "1" else "0"}|${route.payload.url}"
                    ProfilesRoute.Scan -> "scan"
                    is ProfilesRoute.Usage -> "usage|${route.profileId}|${route.profileName}"
                }
            },
        )
    },
    restore = { saved ->
        saved.map { key ->
            when {
                key == "scan" -> ProfilesRoute.Scan
                key.startsWith("usage|") -> {
                    val encoded = key.removePrefix("usage|")
                    ProfilesRoute.Usage(
                        profileId = encoded.substringBefore('|'),
                        profileName = encoded.substringAfter('|'),
                    )
                }
                key.startsWith("import|") -> {
                    val encoded = key.removePrefix("import|")
                    val entryId = encoded.substringBefore('|')
                    val rest = encoded.substringAfter('|')
                    val apply = rest.substringBefore('|')
                    val url = rest.substringAfter('|')
                    ProfilesRoute.ImportFlow(
                        payload = ImportPayload(url = url, requestedApply = apply == "1"),
                        entryId = entryId,
                    )
                }
                else -> error("unknown profiles route key: $key")
            }
        }
    },
)

/** 根页认得的四个去处。聚成一个值：四个并列回调在调用点读不出哪个是哪个。 */
@Immutable
private data class ProfilesRequests(
    val onImport: () -> Unit,
    val onDelete: (Profile) -> Unit,
    val onShowDetail: (Profile) -> Unit,
    val onOpenUsage: (Profile) -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfilesRoot(vm: ProfilesViewModel, requests: ProfilesRequests) {
    val haptics = LocalHapticFeedback.current
    // 刷新结局触感（success=Confirm / error=Reject）：drop(1) 跳过重组进入时的驻留态，只对迁移发触感。
    LaunchedEffect(vm) {
        snapshotFlow { vm.refreshState }
            .drop(1)
            .collect { state ->
                when (state) {
                    ProfilesViewModel.RefreshState.SUCCESS ->
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    ProfilesViewModel.RefreshState.FAILED ->
                        haptics.performHapticFeedback(HapticFeedbackType.Reject)
                    else -> {}
                }
            }
    }
    // 当前项换了（点行切换、删掉当前项后的自动提升）：选中标记移动，发一次选择触感。
    LaunchedEffect(vm) {
        snapshotFlow { vm.activeProfile?.id }
            .drop(1)
            .collect { haptics.performHapticFeedback(HapticFeedbackType.SegmentTick) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .screenBackground()
            .statusBarsPadding(),
    ) {
        // **没有固定顶栏区**：整页就是一块列表区。
        // dock 上那个标签已经说了这是哪一页，再画一行「配置」只是重复它。
        if (vm.hasProfiles) {
            // 下拉与列表上方「更新全部」是**同一个整页动作**，共用整页守卫
            // （在 `ProfilesViewModel.refreshAll`）。行菜单里的「刷新」是**第三个入口**，
            // 走 `refresh(profile)` 与每行的在飞计数，**不受这道整页守卫约束**。
            PullToRefreshBox(
                isRefreshing = vm.refreshState == ProfilesViewModel.RefreshState.REFRESHING,
                onRefresh = vm::refreshAll,
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    // 宽屏上把列表收到 `Theme.maxReadableWidth` 并居中。
                    // 代价：收的是列表**自己的宽**，于是宽屏上两侧留白里滑不动 ——
                    // 与走 `verticalScroll` 的那几屏不同（那边滚动留在外层、整面可滑）。
                    modifier = Modifier.fillMaxSize().readableContentWidth(),
                    contentPadding = PaddingValues(
                        start = Theme.Spacing.lg,
                        end = Theme.Spacing.lg,
                        // 顶部 `16`：整页就是列表区，从页面顶部内衬 `16` 起；
                        // 没有这一行，列表会**贴着状态栏**起画。
                        top = Theme.Spacing.lg,
                        bottom = LIST_BOTTOM_PADDING,
                    ),
                ) {
                    vm.activeProfile?.let { active ->
                        item(key = "summary") {
                            ProfileSummaryCard(
                                profile = active,
                                productWebsite = BuildConfig.WEBSITE_URL,
                                body = SummaryCardBody.Static,
                            )
                            Spacer(Modifier.height(SUMMARY_TO_UPDATE_ALL))
                        }
                    }
                    item(key = "updateAll") { UpdateAllButton(vm) }
                    item(key = "list") { ProfileListCard(vm, requests) }
                }
            }
        } else {
            Box(Modifier.fillMaxSize()) {
                EmptyState(
                    icon = painterResource(FluentR.drawable.ic_fluent_stack_24_regular),
                    title = stringResource(R.string.profiles_empty_title),
                    caption = stringResource(R.string.profiles_empty_caption),
                    actionLabel = stringResource(R.string.profiles_empty_import),
                    onAction = requests.onImport,
                    // 水平边距 = 本页页边距（同列表那份 `contentPadding` 的左右值）。
                    modifier = Modifier.padding(horizontal = Theme.Spacing.lg),
                )
            }
        }
    }
}

/**
 * 「更新全部」：列表上方右侧，只放这一枚、不配标题文字——摘要卡已经说了这是配置。
 * 进行中换成不确定型转圈并退出强调色（换色对，不压透明度）；两态同高，列表不上下跳。
 */
@Composable
private fun UpdateAllButton(vm: ProfilesViewModel) {
    val refreshing = vm.refreshState == ProfilesViewModel.RefreshState.REFRESHING
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        TextButton(
            onClick = vm::refreshAll,
            enabled = !refreshing,
            // 标签右缘落在卡内读字边上（卡沿再进 `16`），与列表行的文字同一条竖线。
            contentPadding = PaddingValues(horizontal = Theme.Spacing.lg),
            colors = ButtonDefaults.textButtonColors(
                contentColor = Theme.colors.accent,
                disabledContentColor = Theme.colors.textSecondary,
            ),
        ) {
            Box(Modifier.size(UPDATE_ALL_GLYPH), contentAlignment = Alignment.Center) {
                if (refreshing) {
                    CircularProgressIndicator(
                        color = Theme.colors.textSecondary,
                        strokeWidth = UPDATE_ALL_SPINNER_STROKE,
                        modifier = Modifier.size(UPDATE_ALL_GLYPH),
                    )
                } else {
                    Icon(
                        painter = painterResource(FluentR.drawable.ic_fluent_arrow_clockwise_24_regular),
                        contentDescription = null,
                        modifier = Modifier.size(UPDATE_ALL_GLYPH),
                    )
                }
            }
            Spacer(Modifier.width(Theme.Spacing.xs))
            Text(
                text = stringResource(if (refreshing) R.string.profiles_refreshing else R.string.profiles_update_all),
                style = Theme.Type.status,
            )
        }
    }
}

/**
 * 列表卡：每份配置一行，**行与行之间不画分隔线**；卡末一行「导入配置」。
 *
 * 卡内嵌着带底色的圆角块（当前项的 `accentContainer`、各行的按下填充），
 * 故取 `panel 18` + 内衬 `6`：`18 − 6 = 12` 正好是行的 `Radius.control`，内外同心。
 */
@Composable
private fun ProfileListCard(vm: ProfilesViewModel, requests: ProfilesRequests) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(Theme.Radius.panel)
            .padding(Theme.Spacing.panelInset),
    ) {
        for (profile in vm.profiles) {
            ProfileRow(
                profile = profile,
                state = vm.rowState(profile),
                handlers = ProfileRowHandlers(
                    activate = { vm.activate(profile.id) },
                    openUsage = { requests.onOpenUsage(profile) },
                    showDetail = { requests.onShowDetail(profile) },
                    refresh = { vm.refresh(profile) },
                    delete = { requests.onDelete(profile) },
                ),
            )
        }
        ProfileImportRow(onClick = requests.onImport)
    }
}

/** 摘要卡与「更新全部」之间。 */
private val SUMMARY_TO_UPDATE_ALL = 14.dp
private val UPDATE_ALL_GLYPH = 13.dp
private val UPDATE_ALL_SPINNER_STROKE = 1.5.dp
