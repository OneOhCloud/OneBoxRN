package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.components.HelpBlock
import cloud.oneoh.oneboxn.ui.components.HelpSheet
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.Rule
import androidx.compose.runtime.Immutable
import cloud.oneoh.oneboxn.ui.components.ActionItem
import cloud.oneoh.oneboxn.ui.components.ActionRow
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.ui.components.InputCaption
import cloud.oneoh.oneboxn.ui.components.InputField
import cloud.oneoh.oneboxn.ui.components.InputGround
import cloud.oneoh.oneboxn.ui.components.RuleBadge
import cloud.oneoh.oneboxn.ui.components.RuleChip
import cloud.oneoh.oneboxn.ui.components.RuleComposer
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import androidx.compose.ui.graphics.Color
import com.microsoft.fluent.mobile.icons.R as FluentR

// 生效说明的行高倍数（行高 = 字号 × `1.375`）。
// **只留倍数，不把乘出来的结果写死**：写死等于把 `note` 的字号编进一个看不出来的地方，
// 档一改这个数就错，而它不会红。
private const val NOTE_LINE_HEIGHT_MULTIPLE = 1.375f

// 路由规则页：列表 = RuleStore 规范序快照，
// ≥12 条出现搜索、编辑器 sheet、帮助 sheet、删除确认（行左滑与编辑器按钮两入口共用）；
// 增删改经 RulesViewModel → RuleActions（持久化 + applyConfigurationChange 单点）。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RulesScreen(onBack: () -> Unit) {
    val vm: RulesViewModel = viewModel { RulesViewModel(app.actions) }
    var composerTarget by remember { mutableStateOf<ComposerTarget?>(null) }
    var showHelp by remember { mutableStateOf(false) }
    var deleteCandidate by remember { mutableStateOf<Rule?>(null) }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rules_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_chevron_left_24_regular),
                            contentDescription = stringResource(R.string.back),
                        )
                    }
                },
                // 顶栏只留帮助。**主操作不放工具栏**：工具栏容量取决于窗口宽度，
                // 放在这里等于挂在一个不保证存在的位置；「添加规则」的唯一入口是内容区那张操作卡。
                // 一个动作一个入口——两个入口比只有任一个都糟（等价的重复路径）。
                // 空态 CTA 与操作卡虽是两处派发点，但由互斥分支驱动（空态 ↔ 列表），屏上不会同时出现。
                actions = {
                    IconButton(onClick = { showHelp = true }) {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_question_circle_24_regular),
                            contentDescription = stringResource(R.string.rules_help),
                        )
                    }
                },
                colors = pageTopBarColors(),
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (vm.rules.isEmpty()) {
                EmptyState(
                    icon = painterResource(FluentR.drawable.ic_fluent_arrow_split_24_regular),
                    title = stringResource(R.string.rules_empty_title),
                    caption = stringResource(R.string.rules_empty_caption),
                    actionLabel = stringResource(R.string.rules_empty_add),
                    onAction = { composerTarget = ComposerTarget.Add },
                    // 水平边距 = 本页页边距（同内容支那一份 `Theme.Spacing.lg`）。
                    modifier = Modifier.readableContentWidth().padding(horizontal = Theme.Spacing.lg),
                )
            } else {
                RulesList(
                    vm = vm,
                    actions = RulesListActions(
                        onAdd = { composerTarget = ComposerTarget.Add },
                        onEdit = { composerTarget = ComposerTarget.Edit(it) },
                        onDeleteRequest = { deleteCandidate = it },
                    ),
                )
            }
        }
    }

    when (val target = composerTarget) {
        null -> {}
        ComposerTarget.Add -> RuleComposer(
            editing = null,
            // 批量提交仅有效 token（校验/去重在编辑器派生，语义在 core RuleToken/RuleStore）。
            onSave = { action, kind, values -> vm.add(action, kind, values) },
            onDismiss = { composerTarget = null },
        )
        is ComposerTarget.Edit -> RuleComposer(
            editing = target.rule,
            // 编辑取首个有效值，跨 action 迁移经 replace。
            onSave = { action, kind, values ->
                val first = values.firstOrNull() ?: error("composer saved with no valid value")
                vm.replace(target.rule, action, kind, first)
            },
            onDismiss = { composerTarget = null },
            onDelete = { deleteCandidate = target.rule },
        )
    }

    if (showHelp) {
        HelpSheet(onDismiss = { showHelp = false })
    }

    deleteCandidate?.let { candidate ->
        // 删除二次确认；取消零变更，确认走 RuleStore.remove（+ applyConfigurationChange 单点）。
        // 对话框居中、指不回触发它的那一行，故正文写出被删的那一条规则的值。
        AlertDialog(
            onDismissRequest = { deleteCandidate = null },
            containerColor = Theme.colors.background,
            title = { Text(stringResource(R.string.rules_delete_confirm)) },
            text = { Text(candidate.value, fontFamily = FontFamily.Monospace) },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.delete(candidate)
                        deleteCandidate = null
                    },
                ) {
                    Text(stringResource(R.string.delete), color = Theme.tones.error.fg)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteCandidate = null }) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
}

/**
 * 本页内容区认得的三个动作。**聚合成一个参数对象**：它们同属「这份清单能做什么」这一件事，
 * 摊成三个并列回调之后，每加一个入口就要在两处各改一次签名。
 */
@Immutable
private data class RulesListActions(
    val onAdd: () -> Unit,
    val onEdit: (Rule) -> Unit,
    val onDeleteRequest: (Rule) -> Unit,
)

private sealed interface ComposerTarget {
    data object Add : ComposerTarget
    data class Edit(val rule: Rule) : ComposerTarget
}

// LazyColumn 稳定键：三元组即规则身份（无独立 id）；value 经 RuleToken 校验，不含分隔符冲突。
private fun ruleKey(rule: Rule): String = "${rule.action}|${rule.kind}|${rule.value}"

@Composable
private fun RulesList(vm: RulesViewModel, actions: RulesListActions) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = Theme.Spacing.lg)
            .padding(top = Theme.Spacing.lg, bottom = Theme.Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.lg),
    ) {
        Text(
            text = stringResource(R.string.rules_caption),
            style = Theme.Type.subtitle,
            color = Theme.colors.textSecondary,
        )
        if (vm.showsSearch) {
            InputField(
                caption = InputCaption.Label(stringResource(R.string.rules_search)),
                ground = InputGround.Page,
                value = vm.searchText,
                onValueChange = vm::updateSearch,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                ),
            )
        }
        // **规则行同处一张 `surface` 分组卡**，行间不画任何分隔线。
        // 卡片是列表本身而不是每一行：`SwipeToDismissBox` 并不要求行成卡——
        // 行只要有不透明底就能滑开露出下面的动作区。
        //
        // 列表仍是 `LazyColumn`：规则可批量粘贴、条数没有上界，
        // 把它塞进一个 `item {}` 会把整份清单一次性实体化。
        // `fill = false`：卡的高度**随规则条数收缩**，条数多时才涨到视口上限并开始滚动。
        // 默认的 fill=true 会让这张卡恒占满剩余视口——条数少时也拖着一大块纯 surface 空白，
        // 那是用空卡片填满页面。它只改高度约束，卡仍画在惰性容器这一层。
        //
        // **搜索无命中那一句在卡内，不是卡的兄弟**：在列表卡内居中占一行
        // （Apple 那端同一句在 `rulesCard` 之内）。
        LazyColumn(
                // 宽屏上把列表收到 `Theme.maxReadableWidth` 并居中。
                // 代价：收的是列表**自己的宽**，于是宽屏上两侧留白里滑不动 ——
                // 与走 `verticalScroll` 的那几屏不同（那边滚动留在外层、整面可滑）。
                // 取这一支是因为 `LazyColumn` 要保住「整面可滑」就得改成按可用宽算 `contentPadding`，
                // 那要给每个列表再套一层能读到可用宽的容器。两种做法的屏上结果相同，差别只在手势面。
            modifier = Modifier
                .weight(1f, fill = false)
                .fillMaxWidth()
                .readableContentWidth()
                .cardSurface()
                .clip(RoundedCornerShape(Theme.Radius.card)),
            contentPadding = PaddingValues(vertical = Theme.Spacing.xs),
        ) {
            if (vm.filteredRules.isEmpty()) {
                item {
                    Text(
                        text = stringResource(R.string.rules_no_match),
                        style = Theme.Type.control,
                        color = Theme.colors.textSecondary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                    )
                }
            } else {
                items(items = vm.filteredRules, key = ::ruleKey) { rule ->
                    RuleRow(
                        rule = rule,
                        onEdit = { actions.onEdit(rule) },
                        onDelete = { actions.onDeleteRequest(rule) },
                    )
                }
            }
        }
        // 操作卡：「添加规则」是**主操作**，故落内容区，且这是**唯一入口**——顶栏没有 `+`
        // （见本文件顶栏那段注释）。行件是共用的 `components/ActionRows.kt`。
        SettingsGroup(label = null) {
            ActionRow(
                item = ActionItem(
                    label = stringResource(R.string.rules_add),
                    icon = FluentR.drawable.ic_fluent_add_24_regular,
                ),
                interaction = RowInteraction.Clickable(actions.onAdd),
            )
        }
        Text(
            text = stringResource(R.string.rules_restart_note),
            // 生效说明：**行高 = 字号 × `1.375`**。
            // **放在调用点而不是 `note` 档里**：只有本屏定了这个行高，写进档里等于替 `note` 的
            // 其余消费方也定了一个行高。（Apple 同形：它的 `noteLineHeightMultiple` 也住在
            // `RulesScreen.swift` 里。）
            style = Theme.Type.note.copy(
                lineHeight = Theme.Type.note.fontSize * NOTE_LINE_HEIGHT_MULTIPLE,
            ),
            color = Theme.colors.textSecondary,
        )
    }
}

// 规则行：分组卡内的一行 + 原生滑动删除（SwipeToDismissBox）。
// 系统绘制的滑动动作区是原生功能控制层，不受「禁止直角」约束。
// 滑动只负责露出删除动作——滑到底也不删，行随即复位，删除由确认对话决定（机制见下方 reset）。
// 起始边方向禁用（本行只有删除一个动作）。点卡进编辑器。
@Composable
private fun RuleRow(
    rule: Rule,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val deleteLabel = stringResource(R.string.delete)
    val dismissState = rememberSwipeToDismissBoxState()

    // 滑到底不删除——弹确认后立即把行复位，删除与否由确认对话决定。
    // 用 reset 而非 confirmValueChange 否决：后者已废弃，且零警告门禁不接受抑制。
    LaunchedEffect(dismissState.currentValue) {
        if (dismissState.currentValue == SwipeToDismissBoxValue.EndToStart) {
            onDelete()
            dismissState.reset()
        }
    }

    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            // 系统滑动动作区：error 语义色 + trash 图标（危险操作）。
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Theme.tones.error.container, RoundedCornerShape(Theme.Radius.card))
                    .padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(
                    painter = painterResource(FluentR.drawable.ic_fluent_delete_24_regular),
                    contentDescription = deleteLabel,
                    tint = Theme.tones.error.fg,
                )
            }
        },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Theme.RowMetrics.minHeight)
                // 不透明底，滑开时露出下面的动作区；卡片在列表那一层，行不各自成卡。
                .background(Theme.colors.surface)
                .clickable(onClick = onEdit)
                .semantics {
                    // 滑动手势的无障碍替代路径：自定义动作直达删除确认。
                    customActions = listOf(
                        CustomAccessibilityAction(deleteLabel) {
                            onDelete()
                            true
                        },
                    )
                }
                .padding(horizontal = Theme.Spacing.lg, vertical = Theme.RowMetrics.verticalPadding),
        ) {
            RuleBadge(action = rule.action)
            RuleChip(kind = rule.kind)
            Text(
                text = rule.value,
                style = Theme.Type.meta.copy(fontFamily = FontFamily.Monospace),
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
    }
}

// 帮助 sheet：动作 / 匹配类型 / 优先级的静态说明。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HelpSheet(onDismiss: () -> Unit) {
    // 三屏的帮助弹层逐项同构，共用 Components/HelpSheet。
    HelpSheet(
        title = stringResource(R.string.rules_help_title),
        blocks = listOf(
        HelpBlock(
            title = stringResource(R.string.rules_help_actions_title),
            body = stringResource(R.string.rules_help_actions_body),
        ),
        HelpBlock(
            title = stringResource(R.string.rules_help_kinds_title),
            body = stringResource(R.string.rules_help_kinds_body),
        ),
        HelpBlock(
            title = stringResource(R.string.rules_help_priority_title),
            body = stringResource(R.string.rules_help_priority_body),
        ),
        ),
        onDismiss = onDismiss,
    )
}
