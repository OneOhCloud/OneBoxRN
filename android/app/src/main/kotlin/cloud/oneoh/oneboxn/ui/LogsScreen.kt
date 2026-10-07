package cloud.oneoh.oneboxn.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.LogEntry
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.components.TextHeightGlyph
import cloud.oneoh.oneboxn.ui.components.TonalCapsuleButton
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.ui.components.SearchField
import cloud.oneoh.oneboxn.ui.components.TOOLBAR_MENU_MAX_HEIGHT
import cloud.oneoh.oneboxn.ui.components.ToolbarMenu
import com.microsoft.fluent.mobile.icons.R as FluentR
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 日志页：条目来自唯一缓冲 LogStore（经 LogsViewModel 投影），
// 工具栏来源/级别两枚菜单、等宽正文、贴底自动跟随 + 离底「回到最新」胶囊、清空、双空态。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogsScreen(onBack: () -> Unit) {
    val vm: LogsViewModel = viewModel { LogsViewModel(app.logStore) }
    val state by vm.uiState.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.logs_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_chevron_left_24_regular),
                            contentDescription = stringResource(R.string.back),
                        )
                    }
                },
                actions = {
                    // 来源菜单：锚点显示当前来源，选中项对勾；与级别菜单同形态。
                    var sourceMenuOpen by remember { mutableStateOf(false) }
                    Box {
                        val sourceName = stringResource(R.string.logs_source_label)
                        val sourceValue = stringResource(sourceLabel(state.filter))
                        // 只显示当前值的控件必须有一个说明它控制什么的无障碍名：
                        // 锚点上只有取值，读屏念出来是孤零零一个「引擎」。判准是把这个控件从屏上抠下来
                        // 单独念听不听得出它管什么。`contentDescription` 给「是什么」，
                        // `stateDescription` 给「现在是哪个值」——只给前者会把取值从读屏里弄丢。
                        TextButton(
                            onClick = { sourceMenuOpen = true },
                            modifier = Modifier.semantics {
                                contentDescription = sourceName
                                stateDescription = sourceValue
                            },
                        ) {
                            Text(sourceValue)
                        }
                        // **自绘弹出面板，不用 `DropdownMenu`**。
                        ToolbarMenu(
                            expanded = sourceMenuOpen,
                            options = LogsViewModel.SourceFilter.entries.toList(),
                            selected = state.filter,
                            maxPanelHeight = TOOLBAR_MENU_MAX_HEIGHT,
                            optionTitle = { stringResource(sourceLabel(it)) },
                            onDismiss = { sourceMenuOpen = false },
                            onSelect = { vm.selectFilter(it) },
                        )
                    }
                    // 呈现级别菜单：锚点显示当前档名，选中项对勾；选择触感同分段（SegmentTick）。
                    var levelMenuOpen by remember { mutableStateOf(false) }
                    Box {
                        val levelName = stringResource(R.string.logs_level_label)
                        val levelValue = levelLabel(state.levelFilter)
                        // 只显示当前值的控件必须有一个说明它控制什么的无障碍名：
                        // 锚点上只有取值，读屏念出来是孤零零一个「引擎」。判准是把这个控件从屏上抠下来
                        // 单独念听不听得出它管什么。`contentDescription` 给「是什么」，
                        // `stateDescription` 给「现在是哪个值」——只给前者会把取值从读屏里弄丢。
                        TextButton(
                            onClick = { levelMenuOpen = true },
                            modifier = Modifier.semantics {
                                contentDescription = levelName
                                stateDescription = levelValue
                            },
                        ) {
                            Text(levelValue)
                        }
                        // **自绘弹出面板，不用 `DropdownMenu`**。
                        ToolbarMenu(
                            expanded = levelMenuOpen,
                            options = selectableLevels,
                            selected = state.levelFilter,
                            maxPanelHeight = TOOLBAR_MENU_MAX_HEIGHT,
                            optionTitle = { levelLabel(it) },
                            onDismiss = { levelMenuOpen = false },
                            onSelect = { vm.selectLevel(it) },
                        )
                    }
                    // 清空入口仅在有日志时显示；触发 → 轻触感（light=ContextClick）+ 清缓冲（过滤保持当前段）。
                    if (state.hasEntries) {
                        TextButton(onClick = {
                            haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                            vm.clear()
                        }) {
                            Text(stringResource(R.string.logs_clear))
                        }
                    }
                },
                colors = pageTopBarColors(),
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (!state.hasEntries) {
                EmptyState(
                    icon = painterResource(FluentR.drawable.ic_fluent_text_align_left_24_regular),
                    title = stringResource(R.string.logs_empty_title),
                    caption = stringResource(R.string.logs_empty_caption),
                    // 水平边距 = 本页页边距（同列表那份 `contentPadding` 的左右值）。
                    modifier = Modifier.readableContentWidth().padding(horizontal = Theme.Spacing.lg),
                )
            } else {
                LogsContent(
                    filtered = state.filteredEntries,
                    keyword = state.keyword,
                    onKeywordChange = vm::enterKeyword,
                )
            }
        }
    }
}

@Composable
private fun LogsContent(
    filtered: List<LogEntry>,
    keyword: String,
    onKeywordChange: (String) -> Unit,
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val reduceMotion = Theme.reduceMotion
    val density = LocalDensity.current
    val thresholdPx = with(density) { 48.dp.toPx() }
    // 离底检测：视口末端距内容末端 > 48dp 即视为离底。
    val atBottom by remember {
        derivedStateOf { listState.isNearBottom(thresholdPx) }
    }
    // 跟随真相：只在滚动结束时按贴底与否更新——用户上滚脱离即暂停跟随，拖回底部/点浮钮即恢复；
    // 新行追加不产生滚动事件，跟随态不被日志风暴破坏。
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }
            .collect { scrolling -> if (!scrolling) follow = listState.isNearBottom(thresholdPx) }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SearchRow(keyword = keyword, onKeywordChange = onKeywordChange)
        Box(Modifier.fillMaxSize()) {
            if (filtered.isEmpty()) {
                Text(
                    text = stringResource(R.string.logs_no_match),
                    style = Theme.Type.control,
                    color = Theme.colors.textSecondary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    textAlign = TextAlign.Center,
                )
            } else {
                LazyColumn(
                    // 宽屏上把列表收到 `Theme.maxReadableWidth` 并居中。
                    // 代价：收的是列表**自己的宽**，于是宽屏上两侧留白里滑不动 ——
                    // 与走 `verticalScroll` 的那几屏不同（那边滚动留在外层、整面可滑）。
                    // `LazyColumn` 要保住「整面可滑」就得按可用宽算 `contentPadding`，
                    // 那要给每个列表套一层 `BoxWithConstraints`；两种做法的屏上结果相同，差别只在手势面。
                    state = listState,
                    modifier = Modifier.fillMaxSize().readableContentWidth(),
                    contentPadding = PaddingValues(start = Theme.Spacing.lg, end = Theme.Spacing.lg, bottom = Theme.Spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(items = filtered, key = { it.id }) { entry ->
                        LogRow(entry)
                    }
                }
                // 自动跟随：贴底时新行到达滚至末项（键取末项 id——容量满时逐旧行数不变，size 不可靠）；
                // 进入即落底（正序，底部为最新）。用户滚动中不抢滚。
                LaunchedEffect(filtered.lastOrNull()?.id) {
                    if (follow && filtered.isNotEmpty() && !listState.isScrollInProgress) {
                        listState.scrollToItem(filtered.lastIndex)
                    }
                }
            }
            // 出现/消失 `200ms` 透明度过渡（`Motion.PILL_MS`；尊重减少动态）。
            androidx.compose.animation.AnimatedVisibility(
                visible = !atBottom && filtered.isNotEmpty(),
                enter = fadeIn(motionSpec(Motion.PILL_MS)),
                exit = fadeOut(motionSpec(Motion.PILL_MS)),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 12.dp),
            ) {
                FollowPill(
                    onClick = {
                        follow = true
                        scope.launch {
                            if (reduceMotion) {
                                listState.scrollToItem(filtered.lastIndex)
                            } else {
                                listState.animateScrollToItem(filtered.lastIndex)
                            }
                        }
                    },
                )
            }
        }
    }
}

// 关键词搜索行：常驻列表之上，输入即筛。
//
// 不用可展开的搜索按钮：关键词是自由文本、没有可当锚点的短标签（来源/级别菜单的锚点文字
// 本身就说明了当前值），「当前是否在过滤」必须一眼可见。
//
// **容器交给共享组件**：底色、圆角、内衬、最小高、聚焦表现全部由组件给，页面不自绘一份同形的输入。
@Composable
private fun SearchRow(keyword: String, onKeywordChange: (String) -> Unit) {
    // 水平边距 `16` 是这一行相对列表的**外**边距，不是容器内衬。
    Box(Modifier.padding(horizontal = Theme.Spacing.lg)) {
        SearchField(
            value = keyword,
            onValueChange = onKeywordChange,
            placeholder = stringResource(R.string.logs_search_placeholder),
        )
    }
}

// 视口末端是否贴近内容末端（末项可见且其底边进入视口末端 + 阈值范围）。
private fun LazyListState.isNearBottom(thresholdPx: Float): Boolean {
    val info = layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return true
    if (last.index < info.totalItemsCount - 1) return false
    return last.offset + last.size <= info.viewportEndOffset + thresholdPx
}

// 回到最新胶囊：accentContainer 容器 + textPrimary 前景，点按平滑滚到底部并恢复跟随。
@Composable
private fun FollowPill(onClick: () -> Unit, modifier: Modifier = Modifier) {
    TonalCapsuleButton(onClick = onClick, modifier = modifier) {
        TextHeightGlyph(painterResource(FluentR.drawable.ic_fluent_arrow_download_24_regular))
        Text(
            text = stringResource(R.string.logs_follow),
            style = Theme.Type.status,
        )
    }
}

// 日志行：级别列 + 时间 + 等宽正文（来源由所选过滤段表达，行内不重复）。
// 整行可点即复制；复制后短暂着底色，只改背景不改布局，避免位置偏移。
@Composable
private fun LogRow(entry: LogEntry) {
    val isError = entry.isError
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    // 以**次数**为键而非 copied 本身：连续复制同一行时 copied 恒为 true，键不变则计时器不重启，
    // 再次复制的反馈会被上一次的计时器提前掐断（每次成功都要短暂反馈约 1 秒）。
    var copyCount by remember { mutableIntStateOf(0) }
    LaunchedEffect(copyCount) {
        if (copyCount == 0) return@LaunchedEffect
        copied = true
        delay(LOG_ROW_COPIED_FEEDBACK_MS)
        copied = false
    }
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val hovered by interactionSource.collectIsHoveredAsState()
    // 底色优先级链：**复制成功 > 按下 > 悬停 > 透明**。
    // 本行是命中区，而**屏上必须有东西说明它可点**（`rowHover` / `rowActive` 与 `ProfileRow`、`SettingsRows` 同源）。
    val rowFill by animateColorAsState(
        targetValue = when {
            copied -> Theme.tones.success.container
            pressed -> Theme.colors.rowActive
            hovered -> Theme.colors.rowHover
            else -> Color.Transparent
        },
        animationSpec = motionSpec(Motion.ROW_MS),
        label = "logRowFill",
    )
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier
            .fillMaxWidth()
            // 底色块本身是 `Radius.control` 的**圆角块**，**不是一条通栏矩形**（严禁直角）。
            .background(rowFill, RoundedCornerShape(Theme.Radius.control))
            .clickable(
                onClickLabel = stringResource(R.string.copy),
                role = Role.Button,
                interactionSource = interactionSource,
                indication = LocalIndication.current,
            ) {
                scope.launch {
                    // 与平台日志设施镜像同形，粘贴后仍能分辨级别。
                    // 可检测的写失败不给成功反馈（与 iOS 同契约：单点返回是否无可检测失败）。
                    if (clipboard.writeText("log", "${logTimeLabel(entry.timeMillis)} [${entry.level.token}] ${entry.message}")) {
                        copyCount += 1
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    }
                }
            },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // 行高：**元信息行与正文行同档**。
            Text(
                text = entry.level.name,
                style = Theme.Type.meta
                    .copy(fontFamily = FontFamily.Monospace)
                    .monoLeading(Theme.Type.MonoLeading.Row),
                color = logLevelColor(entry.level),
                textAlign = TextAlign.End,
                modifier = Modifier.width(LOG_ROW_LEVEL_COLUMN_WIDTH),
            )
            Text(
                text = logTimeLabel(entry.timeMillis),
                style = Theme.Type.meta.tabular().monoLeading(Theme.Type.MonoLeading.Row),
                color = Theme.colors.textSecondary,
            )
        }
        // 两行结构：元信息行（级别列 + 时间，均等宽 `11`）+ 正文行（`11` 等宽），两行同档。
        //
        // 行高走**列表行**那一档（`MonoLeading.Row` = `1.55`），**不是配置正文那档 `1.625`**：
        // 参考实现给这两块的行高本来就是两个数。
        Text(
            text = entry.message,
            style = Theme.Type.meta
                .copy(fontFamily = FontFamily.Monospace)
                .monoLeading(Theme.Type.MonoLeading.Row),
            color = if (isError) Theme.tones.error.fg else Theme.colors.textPrimary,
        )
    }
}

/** 级别列宽：容得下最长 token（PANIC / TRACE / DEBUG / ERROR 五字符）。 */
private val LOG_ROW_LEVEL_COLUMN_WIDTH = 42.dp

/** 复制反馈时长。 */
private const val LOG_ROW_COPIED_FEEDBACK_MS = 1000L

@Composable
private fun logLevelColor(level: LogLevel) = when {
    level >= LogLevel.ERROR -> Theme.tones.error.fg
    level == LogLevel.WARN -> Theme.tones.warning.fg
    else -> Theme.colors.textSecondary
}

// 可选档全集（fatal/panic 恒 ≥ error，不单设档位）。
private val selectableLevels = listOf(
    LogLevel.TRACE, LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR,
)

private fun sourceLabel(filter: LogsViewModel.SourceFilter): Int = when (filter) {
    LogsViewModel.SourceFilter.ENGINE -> R.string.logs_filter_engine
    LogsViewModel.SourceFilter.APP -> R.string.logs_filter_app
}

@Composable
private fun levelLabel(level: LogLevel): String = stringResource(
    when (level) {
        LogLevel.TRACE -> R.string.logs_level_trace
        LogLevel.DEBUG -> R.string.logs_level_debug
        LogLevel.INFO -> R.string.logs_level_info
        LogLevel.WARN -> R.string.logs_level_warn
        LogLevel.ERROR -> R.string.logs_level_error
        // 不可选档（恒 ≥ error 可见，无档位语义）；到达即编程错误。
        LogLevel.FATAL, LogLevel.PANIC -> error("level $level is not selectable")
    },
)

// 日志时刻显示（时间字段的呈现）：仅主线程使用，单实例复用。
private val logTimeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

private fun logTimeLabel(epochMillis: Long): String = logTimeFormat.format(Date(epochMillis))
