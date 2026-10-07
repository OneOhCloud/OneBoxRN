package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Rule
import cloud.oneoh.oneboxn.core.RuleAction
import cloud.oneoh.oneboxn.core.RuleKind
import cloud.oneoh.oneboxn.core.RuleToken
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.Tone
import cloud.oneoh.oneboxn.ui.tabular
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.launch

// 规则编辑 sheet：动作/匹配类型分段 + 多行批量输入 + 实时校验与预览。
// 分词/normalize/校验全经 core RuleToken（校验唯一实现），本层零第二套规则；
// 新增可批量（每行/逗号一条），编辑预填并取首个有效值。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuleComposer(
    editing: Rule?,
    onSave: (RuleAction, RuleKind, List<String>) -> Unit,
    onDismiss: () -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var action by remember(editing) { mutableStateOf(editing?.action ?: RuleAction.PROXY) }
    var kind by remember(editing) { mutableStateOf(editing?.kind ?: RuleKind.DOMAIN_SUFFIX) }
    var valueText by remember(editing) { mutableStateOf(editing?.value ?: "") }
    var noneValid by remember(editing) { mutableStateOf(false) }

    val tokens = composerTokens(valueText, kind)

    fun dismissThen(actionAfter: () -> Unit) {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            onDismiss()
            actionAfter()
        }
    }

    ModalBottomSheet(
        // 弹层也是内容区：`ModalBottomSheet` 的 M3 默认上限 `640` 比内容区上限 `600` 宽，
        // 不给它，宽屏上弹层比页面还宽。
        sheetMaxWidth = Theme.maxReadableWidth,
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SheetPanel.PlainPanel.color(),
        shape = RoundedCornerShape(topStart = Theme.Radius.panel, topEnd = Theme.Radius.panel),
    ) {
        Column(Modifier.imePadding()) {
            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Theme.sheetInset),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = stringResource(
                        if (editing == null) R.string.rules_composer_add else R.string.rules_composer_edit,
                    ),
                    style = Theme.Type.sheetTitle,
                    // 纯文本行在弹层内衬之外再内缩一档，与块里的文字落在同一条读字边线上（内衬只约束带底色的块）。
                    modifier = Modifier
                        .padding(horizontal = Theme.Spacing.textInset)
                        .padding(top = Theme.Spacing.lg),
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.rules_composer_action),
                        style = Theme.Type.subtitle,
                        color = Theme.colors.textSecondary,
                    )
                    SegmentPicker(
                        options = RuleAction.entries.map { it to ruleActionLabel(it) },
                        selection = action,
                        onSelect = { action = it },
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.rules_composer_kind),
                        style = Theme.Type.subtitle,
                        color = Theme.colors.textSecondary,
                    )
                    SegmentPicker(
                        options = selectableKinds(editing).map { it to ruleKindLabel(it) },
                        selection = kind,
                        onSelect = { kind = it },
                    )
                }
                InputField(
                    caption = InputCaption.Label(stringResource(R.string.rules_composer_values)),
                    ground = InputGround.Surface,
                    value = valueText,
                    onValueChange = {
                        valueText = it
                        noneValid = false
                    },
                    placeholder = if (kind == RuleKind.IP_CIDR) "10.0.0.0/8" else "example.com",
                    multiline = true,
                    error = if (noneValid) stringResource(R.string.rules_composer_none_valid) else null,
                    errorIcon = painterResource(FluentR.drawable.ic_fluent_error_circle_24_regular),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        autoCorrectEnabled = false,
                        keyboardType = if (kind == RuleKind.IP_CIDR) KeyboardType.Number else KeyboardType.Uri,
                    ),
                )
                ValidationSummary(validCount = tokens.valid.size, skippedCount = tokens.skippedCount)
                tokens.valid.firstOrNull()?.let { first ->
                    PreviewRow(action = action, kind = kind, first = first, extraCount = tokens.valid.size - 1)
                }
                Text(
                    text = stringResource(R.string.rules_composer_priority),
                    style = Theme.Type.meta,
                    color = Theme.colors.textSecondary,
                )
            }
            // 操作区固定于 sheet 底部：表单滚动，动作不悬浮在页中。
            // **底色与面板同色**：取 `background` 会在面板里画出一条带子——
            // 亮色是 `#F7F7F7` 压 `#FFFFFF`、暗色是纯黑压 `#1C1C1E`，
            // 那是用色差画出的「用一条带子把区域分开」。Apple 的 `actionBarChrome()` 同理。
            Column(
                modifier = Modifier
                    .background(Theme.colors.surface)
                    .padding(horizontal = Theme.sheetInset)
                    .padding(top = 8.dp)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // 「删除」**贴前缘、取危险色**，与取消 / 保存隔开：紧挨那一对会把「放弃」与「删掉这条规则」摆成一对。
                ButtonRow(
                    leading = {
                        if (editing != null && onDelete != null) {
                            SecondaryButton(
                                label = stringResource(R.string.delete),
                                onClick = { dismissThen(onDelete) },
                                tone = Theme.tones.error,
                            )
                        }
                    },
                ) {
                    QuietButton(
                        label = stringResource(R.string.cancel),
                        onClick = { dismissThen {} },
                    )
                    PrimaryButton(
                        label = stringResource(R.string.rules_save),
                        // 主按钮恒可点，去留由 [composerSubmission] 判；提交只带有效 token，无效项经计数可观察后丢弃。
                        onClick = {
                            when (val submission = composerSubmission(editing, action, kind, tokens)) {
                                ComposerSubmission.NoneValid -> noneValid = true
                                ComposerSubmission.Unchanged -> dismissThen {}
                                is ComposerSubmission.Save ->
                                    dismissThen { onSave(submission.action, submission.kind, submission.values) }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ValidationSummary(validCount: Int, skippedCount: Int) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.rules_composer_valid, validCount.toString()),
            style = Theme.Type.subtitle,
            color = if (validCount == 0) Theme.colors.textSecondary else Theme.tones.success.fg,
        )
        if (skippedCount > 0) {
            Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_error_circle_24_regular),
                contentDescription = null,
                tint = Theme.tones.warning.fg,
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = stringResource(R.string.rules_composer_skipped, skippedCount.toString()),
                style = Theme.Type.subtitle,
                color = Theme.tones.warning.fg,
            )
        }
    }
}

@Composable
private fun PreviewRow(action: RuleAction, kind: RuleKind, first: String, extraCount: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = stringResource(R.string.rules_composer_preview),
            style = Theme.Type.subtitle,
            color = Theme.colors.textSecondary,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                // `fill` 容器 + `Radius.control`：面板自己取 `surface`（面板上没有卡片），
                // 预览块再取 `surface` 就与承载它的面同色、分离度为 0。
                .background(Theme.colors.fill, RoundedCornerShape(Theme.Radius.control))
                .padding(12.dp),
        ) {
            RuleBadge(action = action)
            RuleChip(kind = kind)
            Text(
                text = first,
                style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (extraCount > 0) {
                Text(
                    text = "+$extraCount",
                    style = Theme.Type.subtitle.tabular(),
                    color = Theme.colors.textSecondary,
                )
            }
        }
    }
}

// 编辑态禁止跨类改匹配类型（域名类 ↔ IP 段类互斥），与批量值语义绑定；新增态全可选。
//
// 跨类项**不出现**而不是灰显：原生 Tab 按内容排布，且「点不了的东西就别摆出来」——
// 灰项占着位置，还逼用户逐个试才知道哪个能点。
internal fun selectableKinds(editing: Rule?): List<RuleKind> = when (editing?.kind) {
    null -> RuleKind.entries
    RuleKind.DOMAIN, RuleKind.DOMAIN_SUFFIX -> listOf(RuleKind.DOMAIN, RuleKind.DOMAIN_SUFFIX)
    RuleKind.IP_CIDR -> listOf(RuleKind.IP_CIDR)
}

// 实时派生（纯函数，单测锁定）：分词/normalize/去重经 RuleToken.parseBulk，
// 有效性经 RuleToken.validate——校验唯一实现于 core。
internal fun composerTokens(text: String, kind: RuleKind): ComposerTokens {
    val tokens = RuleToken.parseBulk(text)
    val valid = tokens.filter { RuleToken.validate(kind, it) }
    return ComposerTokens(valid = valid, skippedCount = tokens.size - valid.size)
}

internal data class ComposerTokens(val valid: List<String>, val skippedCount: Int)

/** 点「保存」的去留：一条有效值都没有就地报错；编辑态什么都没改等同关闭；其余落盘。 */
internal sealed interface ComposerSubmission {
    data object NoneValid : ComposerSubmission
    data object Unchanged : ComposerSubmission
    data class Save(val action: RuleAction, val kind: RuleKind, val values: List<String>) : ComposerSubmission
}

internal fun composerSubmission(editing: Rule?, action: RuleAction, kind: RuleKind, tokens: ComposerTokens): ComposerSubmission =
    when {
        tokens.valid.isEmpty() -> ComposerSubmission.NoneValid
        editing != null && editing.action == action && editing.kind == kind && tokens.valid == listOf(editing.value) ->
            ComposerSubmission.Unchanged
        else -> ComposerSubmission.Save(action, kind, tokens.valid)
    }

@Composable
fun ruleActionLabel(action: RuleAction): String = stringResource(
    when (action) {
        RuleAction.REJECT -> R.string.rules_action_reject
        RuleAction.DIRECT -> R.string.rules_action_direct
        RuleAction.PROXY -> R.string.rules_action_proxy
    },
)

@Composable
fun ruleKindLabel(kind: RuleKind): String = stringResource(
    when (kind) {
        RuleKind.DOMAIN -> R.string.rules_kind_domain
        RuleKind.DOMAIN_SUFFIX -> R.string.rules_kind_suffix
        RuleKind.IP_CIDR -> R.string.rules_kind_cidr
    },
)

// 动作徽章：语义色容器 + 文字（规则行与编辑器预览共用）。
@Composable
fun RuleBadge(action: RuleAction) {
    val tone = when (action) {
        RuleAction.REJECT -> Theme.tones.error
        RuleAction.DIRECT -> Theme.tones.success
        // 不手写 `fg = accent`：`accent` 压 `accentContainer` 暗色下只有 `3.27:1`。
        // 与 iOS 同一个组件、同一个 action 用同一个具名令牌。
        RuleAction.PROXY -> Theme.secondaryActionOnAccent
    }
    Text(
        text = ruleActionLabel(action),
        style = Theme.Type.badge,
        color = tone.fg,
        modifier = Modifier
            .background(tone.container, CircleShape)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

// 匹配类型标签（中性弱容器）。
@Composable
fun RuleChip(kind: RuleKind) {
    Text(
        text = ruleKindLabel(kind),
        style = Theme.Type.badge,
        color = Theme.colors.textSecondary,
        modifier = Modifier
            .background(Theme.colors.fill, CircleShape)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}
