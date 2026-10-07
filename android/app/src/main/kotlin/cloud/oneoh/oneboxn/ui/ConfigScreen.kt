package cloud.oneoh.oneboxn.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.RoutingMode
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.components.TextHeightGlyph
import cloud.oneoh.oneboxn.ui.components.TonalCapsuleButton
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.ui.components.PrimaryButton
import cloud.oneoh.oneboxn.ui.components.StatusOrb
import cloud.oneoh.oneboxn.ui.components.TOOLBAR_MENU_MAX_HEIGHT
import cloud.oneoh.oneboxn.ui.components.ToolbarMenu
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.launch
import androidx.compose.ui.graphics.Color

// 配置查看页：版式同日志页——视图选择与复制都在工具栏，
// 内容区只有固定元信息行 + 行号等宽正文 + 浮动回到顶部胶囊；合并三态（加载 / 就绪 / 失败可重试）；
// 复制写真剪贴板 + 触感 + 按钮两态文案；无激活 profile → 与 Home 同构的整页空态。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigScreen(onBack: () -> Unit) {
    val vm: ConfigViewModel = viewModel {
        ConfigViewModel(app.actions, app.engineVersion)
    }
    // 进入即取激活原文并按当前视图合并（Activity 级 VM 跨次存活，重入重新装载）。
    LaunchedEffect(Unit) { vm.reload() }
    // 离页即释放派生副本（逐行视图与合并投影）：VM 比页面活得久，派生数据不该跟着久留。
    DisposableEffect(Unit) { onDispose { vm.release() } }

    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.config_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_chevron_left_24_regular),
                            contentDescription = stringResource(R.string.back),
                        )
                    }
                },
                actions = {
                    // 视图菜单：锚点显示当前视图，选中项对勾；与日志两枚菜单同形态。
                    if (vm.imported.isNotEmpty()) {
                        var viewMenuOpen by remember { mutableStateOf(false) }
                        Box {
                            val viewName = stringResource(R.string.config_view_label)
                            val viewValue = stringResource(configViewLabel(vm.source))
                            // 只显示当前值的控件必须有一个说明它控制什么的无障碍名：
                        // 锚点上只有取值，读屏念出来是孤零零一个「引擎」。判准是把这个控件从屏上抠下来
                        // 单独念听不听得出它管什么。`contentDescription` 给「是什么」，
                        // `stateDescription` 给「现在是哪个值」——只给前者会把取值从读屏里弄丢。
                        TextButton(
                                onClick = { viewMenuOpen = true },
                                modifier = Modifier.semantics {
                                    contentDescription = viewName
                                    stateDescription = viewValue
                                },
                            ) {
                                Text(viewValue)
                            }
                            // **自绘弹出面板，不用 `DropdownMenu`**。
                            // 面板几何与选中语义走共享件（`components/MenuPanel.kt`），三屏同一份。
                            ToolbarMenu(
                                expanded = viewMenuOpen,
                                options = ConfigViewModel.Source.entries.toList(),
                                selected = vm.source,
                                maxPanelHeight = TOOLBAR_MENU_MAX_HEIGHT,
                                optionTitle = { stringResource(configViewLabel(it)) },
                                onDismiss = { viewMenuOpen = false },
                                onSelect = { vm.selectSource(it) },
                            )
                        }
                    }
                    // 复制当前视图全文；可用性随视图联动（copyableBody 为空即隐藏）。
                    // 已复制反馈就落在按钮自身的两态文案上——不另开第二条反馈通道。
                    val body = vm.copyableBody
                    if (body != null) {
                        val copied = vm.copied
                        TextButton(
                            onClick = {
                                scope.launch {
                                    // 写失败不报「已复制」（与 iOS `Clipboard.write` 的 guard 同契约）。
                                    if (clipboard.writeText("config", body)) vm.markCopied()
                                }
                                // 复制 = light。
                                haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                            },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = if (copied) {
                                    Theme.tones.success.fg
                                } else {
                                    Theme.colors.accent
                                },
                            ),
                        ) {
                            Text(stringResource(if (copied) R.string.copied else R.string.copy))
                        }
                    }
                },
                colors = pageTopBarColors(),
            )
        },
    ) { padding ->
        if (vm.imported.isEmpty()) {
            // 空态：无激活 profile（与 Home/Profiles 同构的 EmptyState 形态）。
            EmptyState(
                icon = painterResource(FluentR.drawable.ic_fluent_stack_24_regular),
                title = stringResource(R.string.profiles_empty_title),
                caption = stringResource(R.string.config_empty_caption),
                // 水平边距 = 本页页边距；组件自己不加，见 EmptyState.kt 文件头。
                modifier = Modifier.padding(padding).readableContentWidth().padding(horizontal = Theme.Spacing.lg),
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MetaLine(vm)
                // **屏内内容替换不走过渡**（与 UI 参考实现一致：这一类用朴素条件渲染，零过渡动画）。
                //
                // **套一层 `Box`，不是直接 `when`**：它在外层 `Column(spacedBy)` 里**恒占一个子项**；
                // 直接展开会让子项数随分支变，间隙跟着变。
                Box(Modifier.weight(1f)) {
                    when (vm.source) {
                        ConfigViewModel.Source.IMPORTED -> NumberedBody(vm.importedLines)
                        ConfigViewModel.Source.MERGED -> MergedBody(vm.mergeState, onRetry = vm::retry)
                    }
                }
            }
        }
    }
}

// 元信息块：引擎版本 · 路由模式；合并就绪时次行 +N 出站 · DNS。
// 字阶与两行结构同日志行（caption2 = labelSmall，行距 2），固定于正文之上不随滚动。
// 两组事实各占一行而非左右分列：窄屏下四项事实挤在一行会互相撞上并折行成一段连读的字。
@Composable
private fun MetaLine(vm: ConfigViewModel) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = Theme.Spacing.lg),
    ) {
        val modeLabel = stringResource(
            when (vm.routingMode) {
                RoutingMode.TUN_RULES -> R.string.settings_routing_mode_rules
                RoutingMode.TUN_GLOBAL -> R.string.settings_routing_mode_global
            },
        )
        Text(
            text = vm.engineVersionLabel + " · " + modeLabel,
            style = Theme.Type.meta.tabular(),
            color = Theme.colors.textSecondary,
        )
        val meta = vm.mergedMeta
        if (vm.source == ConfigViewModel.Source.MERGED && meta != null) {
            Text(
                text = stringResource(
                    R.string.config_merged_meta,
                    meta.injectedOutboundCount.toString(),
                    meta.systemDns ?: "—",
                ),
                style = Theme.Type.meta.tabular(),
                color = Theme.colors.textSecondary,
            )
        }
    }
}

// 合并视图三态：加载 / 就绪 / 失败（附错误详情 + 重试）。
@Composable
private fun MergedBody(mergeState: ConfigViewModel.MergeState, onRetry: () -> Unit) {
    when (mergeState) {
        ConfigViewModel.MergeState.Loading -> Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        ) {
            CircularProgressIndicator(modifier = Modifier.size(48.dp))
            // 加载中：等待指示 + 「正在合并配置…」（`13` `textSecondary`），居中。
            Text(
                text = stringResource(R.string.config_merging),
                style = Theme.Type.status,
                color = Theme.colors.textSecondary,
            )
        }
        is ConfigViewModel.MergeState.Ready -> NumberedBody(mergeState.lines)
        is ConfigViewModel.MergeState.Failed -> Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        ) {
            StatusOrb(
                icon = painterResource(FluentR.drawable.ic_fluent_warning_24_regular),
                tint = Theme.tones.error.fg,
                container = Theme.tones.error.container,
            )
            Text(
                text = stringResource(R.string.config_merge_failed),
                style = Theme.Type.sheetTitle,
                fontWeight = FontWeight.SemiBold,
            )
            // 失败附错误详情。
            Text(
                text = mergeState.detail,
                style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                color = Theme.colors.textSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = Theme.Spacing.lg),
            )
            // 重试键走共享件 `PrimaryButton`：同形不同源，字号与左右内衬会各自漂掉。
            PrimaryButton(
                label = stringResource(R.string.config_retry),
                onClick = onRetry,
            )
        }
    }
}

// 行号等宽正文：行号右对齐弱化（TalkBack 隐藏），长行换行续排。
// 行数据由状态层的逐行视图注入（状态提升）：视图零派生，切视图/重组不重建；
// 只有在场的行会被切出（TextLines），列表虚拟化因此也省下不可见行的文本副本。
@Composable
private fun NumberedBody(lines: List<String>) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val reduceMotion = Theme.reduceMotion
    val thresholdPx = with(LocalDensity.current) { 48.dp.toPx() }
    // 离顶检测：首项可见且滚动偏移 <= 48dp 即视为在顶。
    val atTop by remember { derivedStateOf { listState.isNearTop(thresholdPx) } }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            // 宽屏上把列表收到 `Theme.maxReadableWidth` 并居中。
            // 代价：收的是列表**自己的宽**，于是宽屏上两侧留白里滑不动 ——
            // 与走 `verticalScroll` 的那几屏不同（那边滚动留在外层、整面可滑）。
            // 取这一支是因为 `LazyColumn` 要保住「整面可滑」就得改成按可用宽算 `contentPadding`，
            // 那要给每个列表套一层 `BoxWithConstraints`。两种做法的屏上结果相同，差别只在手势面。
            state = listState,
            modifier = Modifier.fillMaxSize().readableContentWidth(),
            contentPadding = PaddingValues(start = Theme.Spacing.lg, end = Theme.Spacing.lg, bottom = Theme.Spacing.md),
            // **行与行之间不另加间距**：整块正文的行网格由下面那个行高倍数一次给出
            // （行高 = 字号 × `1.625`）。再加 `spacedBy` 会让逻辑行之间多出间距，而一条长行
            // **换行续排**出来的那几行没有 ⇒ 同一块正文里两种行距，长行越多越明显。
        ) {
            itemsIndexed(lines) { index, line ->
                Row(
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = (index + 1).toString(),
                        // 行号与内容**共用同一个行高**，否则两栏的基线从第二行起就分家。
                        style = Theme.Type.meta.tabular().monoLeading(Theme.Type.MonoLeading.Block),
                        color = Theme.colors.textSecondary,
                        textAlign = TextAlign.End,
                        modifier = Modifier
                            .width(28.dp)
                            .clearAndSetSemantics {},
                    )
                    // 行号与内容同为 `11` 等宽——**两者必须相等不是巧合**：整块是一段等宽正文，
                    // 同档才对得上行网格；差一档会让基线与行高对不上，屏上表现为「密密麻麻的一段文字」。
                    Text(
                        text = line,
                        style = Theme.Type.meta.copy(fontFamily = FontFamily.Monospace).monoLeading(Theme.Type.MonoLeading.Block),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        // 出现/消失 `200ms` 透明度过渡（与日志页跟随胶囊同一时长；尊重减少动态）。
        AnimatedVisibility(
            visible = !atTop && lines.isNotEmpty(),
            enter = fadeIn(motionSpec(Motion.PILL_MS)),
            exit = fadeOut(motionSpec(Motion.PILL_MS)),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 12.dp),
        ) {
            BackToTopPill(
                onClick = {
                    scope.launch {
                        if (reduceMotion) listState.scrollToItem(0) else listState.animateScrollToItem(0)
                    }
                },
            )
        }
    }
}

// 视口起点是否贴近内容起点（首项可见且其滚出部分不超过阈值）。
private fun LazyListState.isNearTop(thresholdPx: Float): Boolean =
    firstVisibleItemIndex == 0 && firstVisibleItemScrollOffset <= thresholdPx

// 回到顶部胶囊（`accentContainer` 容器 + `textPrimary` 文字）：点按平滑滚到首行。
@Composable
private fun BackToTopPill(onClick: () -> Unit, modifier: Modifier = Modifier) {
    TonalCapsuleButton(onClick = onClick, modifier = modifier) {
        TextHeightGlyph(painterResource(FluentR.drawable.ic_fluent_arrow_upload_24_regular))
        Text(
            text = stringResource(R.string.config_scroll_top),
            style = Theme.Type.status,
        )
    }
}

private fun configViewLabel(source: ConfigViewModel.Source): Int = when (source) {
    ConfigViewModel.Source.IMPORTED -> R.string.config_view_imported
    ConfigViewModel.Source.MERGED -> R.string.config_view_merged
}
