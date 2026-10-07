package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.ProfileDestination
import cloud.oneoh.oneboxn.ui.COPY_FEEDBACK_MS
import cloud.oneoh.oneboxn.ui.LinkOpenFailedDialog
import cloud.oneoh.oneboxn.ui.ProfilesViewModel
import cloud.oneoh.oneboxn.ui.QuotaState
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.openExternalLink
import cloud.oneoh.oneboxn.ui.profileExpiryDetailOf
import cloud.oneoh.oneboxn.ui.profileUsageDetailOf
import cloud.oneoh.oneboxn.ui.quotaState
import cloud.oneoh.oneboxn.ui.tabular
import cloud.oneoh.oneboxn.ui.updatedAtLabel
import cloud.oneoh.oneboxn.ui.writeText
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

/**
 * 配置详情（配置行长按菜单的「详情」；Apple 对等物 `ProfileDetailSheet`）。卡片之前是头部：站标砖、名称、
 * 主机名胶囊；其下用量与到期一张卡、链接一张卡、操作一张卡、删除单独一张卡——破坏性操作与其余操作隔开。
 *
 * 只呈现 `Profile` 已有的字段，一个都不推断：服务端没下发站点时头部去产品官网，不替这份配置编一个站点。
 * 这里不复述「本机用量」——那是另一份账本、另一种口径，入口是配置行尾的用量图标。
 *
 * [opened] 是打开时的那一份：显示读活值（详情里的刷新会改写用量与到期）；活值不在——刚在这里删掉——
 * 时退回这一份并收起详情，而不是把整张卡画空。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileDetailSheet(vm: ProfilesViewModel, opened: Profile, productWebsite: String, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val live = vm.profiles.firstOrNull { it.id == opened.id }
    val profile = live ?: opened
    val destination = remember(profile.website, productWebsite) {
        ProfileDestination.of(profile.website, productWebsite)
    }
    var pendingDelete by remember { mutableStateOf(false) }
    var linkFailed by remember { mutableStateOf(false) }
    val nameEditor = remember(opened.id) { NameEditor { name -> vm.rename(opened.id, name) } }
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    var copied by remember { mutableStateOf<CopyTarget?>(null) }
    var copyCount by remember { mutableIntStateOf(0) }
    // 换 key 即取消上一轮：连点两次，回执从第二次起重新计时，不会被第一次的到点提前收掉。
    LaunchedEffect(copyCount) {
        if (copied == null) return@LaunchedEffect
        delay(COPY_FEEDBACK_MS)
        copied = null
    }

    /** 内容复制存下来的原文、零改写，同配置页「导入」视图的复制。写失败不给「已复制」回执。 */
    fun copy(target: CopyTarget) {
        // 复制 = light。触感无条件给：它是「点按已被接收」的回执，与「已在剪贴板」是两种信号。
        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
        scope.launch {
            val copiedText = when (target) {
                CopyTarget.URL -> profile.url
                CopyTarget.CONTENT -> vm.content(opened.id)
            }
            if (clipboard.writeText(target.clipLabel, copiedText)) {
                copied = target
                copyCount += 1
            }
        }
    }
    // 刷新在途时刷新与删除都不可点：删掉一份正在写回的配置，写回落空也不会有任何反馈。
    val busy = opened.id in vm.busyIds

    if (live == null) {
        LaunchedEffect(Unit) {
            sheetState.hide()
            onDismiss()
        }
    }

    ModalBottomSheet(
        // 弹层也是内容区：`ModalBottomSheet` 的 M3 默认上限 `640` 比内容区上限 `600` 宽。
        sheetMaxWidth = Theme.maxReadableWidth,
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        // 面板上是 `surface` 卡：面板取 `background`，边界由卡承担。
        containerColor = SheetPanel.GroupedCards.color(),
        shape = RoundedCornerShape(topStart = Theme.Radius.panel, topEnd = Theme.Radius.panel),
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Theme.Spacing.lg)
                .padding(bottom = Theme.sheetBottomInset),
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.cardGap),
        ) {
            SheetTitleBar(
                title = stringResource(R.string.profiles_detail),
                onClose = { scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() } },
            )
            ProfileDetailHeader(
                profile = profile,
                destination = destination,
                nameEditor = nameEditor,
                openSite = { url -> if (!openExternalLink(context, url)) linkFailed = true },
            )
            ProfileFactsCard(profile)
            ProfileLinkCard(profile)
            SettingsGroup(label = null) {
                ActionRow(item = copyItem(CopyTarget.URL, copied), interaction = RowInteraction.Clickable { copy(CopyTarget.URL) })
                ActionRow(
                    item = copyItem(CopyTarget.CONTENT, copied),
                    interaction = RowInteraction.Clickable { copy(CopyTarget.CONTENT) },
                )
                ActionRow(
                    item = refreshItem(vm, opened.id),
                    interaction = if (busy) RowInteraction.Disabled else RowInteraction.Clickable { vm.refresh(profile) },
                )
            }
            DeleteCard(interaction = if (busy) RowInteraction.Disabled else RowInteraction.Clickable { pendingDelete = true })
        }
    }

    if (pendingDelete) {
        ProfileDeleteDialog(
            profile = profile,
            onConfirm = {
                pendingDelete = false
                vm.delete(opened.id)
            },
            onDismiss = { pendingDelete = false },
        )
    }
    if (linkFailed) {
        LinkOpenFailedDialog(onDismiss = { linkFailed = false })
    }
}

/** 两行复制各自的剪贴板来源标签（系统 UI 的来源提示，与写入内容无关）。 */
private enum class CopyTarget(val clipLabel: String) {
    URL("profile-url"),
    CONTENT("profile-content"),
}

/** 刚复制的那一行换成「已复制」回执，另一行不动。逐个写字面资源：i18n 门禁按字面量静态扫。 */
@Composable
private fun copyItem(target: CopyTarget, copied: CopyTarget?): ActionItem = when {
    target == copied -> ActionItem(
        label = stringResource(R.string.copied),
        icon = FluentR.drawable.ic_fluent_checkmark_24_regular,
    )
    target == CopyTarget.URL -> ActionItem(
        label = stringResource(R.string.profiles_copy_url),
        icon = FluentR.drawable.ic_fluent_copy_24_regular,
    )
    else -> ActionItem(
        label = stringResource(R.string.profiles_copy_content),
        icon = FluentR.drawable.ic_fluent_copy_24_regular,
    )
}

/** 头部名称的就地改名：草稿为 null = 不在改名。 */
@Stable
private class NameEditor(private val submit: (String) -> Unit) {
    var draft by mutableStateOf<String?>(null)
        private set

    fun start(current: String) {
        draft = current
    }

    fun edit(text: String) {
        draft = text
    }

    /** 键盘「完成」即提交：草稿原样交出去，空名由 core 拒绝、名字不变；无论结局都收起编辑。 */
    fun commit() {
        val text = draft ?: return
        draft = null
        submit(text)
    }
}

/** 刷新行随这一份配置的刷新状态换字：在途、刚成功、闲置。刚失败回到闲置，错误由配置页的提示框说。 */
@Composable
private fun refreshItem(vm: ProfilesViewModel, id: String): ActionItem = when {
    id in vm.busyIds -> ActionItem(
        label = stringResource(R.string.profiles_refreshing),
        icon = FluentR.drawable.ic_fluent_arrow_clockwise_24_regular,
    )
    vm.rowOutcomes[id] == ProfilesViewModel.RowOutcome.SUCCESS -> ActionItem(
        label = stringResource(R.string.profiles_refresh_done),
        icon = FluentR.drawable.ic_fluent_checkmark_24_regular,
    )
    else -> ActionItem(
        label = stringResource(R.string.profiles_refresh),
        icon = FluentR.drawable.ic_fluent_arrow_clockwise_24_regular,
    )
}

/**
 * 头部：站标砖、名称（铅笔就地改名）、主机名胶囊，居中铺在页面底色上，与关于页的应用图标同一构图。
 *
 * 砖与胶囊点开去同一处。读屏只停胶囊：它带着主机名，砖再停一次就是同一个动作播两遍。
 */
@Composable
private fun ProfileDetailHeader(
    profile: Profile,
    destination: ProfileDestination,
    nameEditor: NameEditor,
    openSite: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
    ) {
        Box(Modifier.clearAndSetSemantics {}) {
            val interactions = remember { MutableInteractionSource() }
            ProfileMarkTile(
                destination = destination,
                metrics = ProfileMarkTileMetrics.detailHeader,
                seat = MarkTileSeat.PAGE,
                interactionSource = interactions,
                modifier = Modifier.clickable(interactions, indication = null, role = Role.Button) { openSite(destination.url) },
            )
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
        ) {
            val draft = nameEditor.draft
            if (draft != null) {
                RenameField(draft, nameEditor)
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
                ) {
                    SelectionContainer(Modifier.weight(1f, fill = false)) {
                        Text(
                            text = profile.name,
                            style = Theme.Type.emptyTitle,
                            // 头部铺的是页面底色，没有当前行 `accentContainer` 的对比度问题，故超额即转色。
                            color = when (quotaState(profile)) {
                                QuotaState.EXCEEDED -> Theme.tones.error.fg
                                QuotaState.WITHIN -> Theme.colors.textPrimary
                            },
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    RenameButton(onClick = { nameEditor.start(profile.name) })
                }
            }
            // 胶囊可见高 `32`，点按区由触控目标扩展给足，不进版式：名称到胶囊的 `8` 不被撑开。
            CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
                TonalCapsuleButton(onClick = { openSite(destination.url) }) {
                    Text(
                        text = destination.hostname,
                        style = Theme.Type.status,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    TextHeightGlyph(painterResource(FluentR.drawable.ic_fluent_arrow_up_right_24_regular))
                }
            }
        }
    }
}

/** 改名输入框：由点铅笔这个明确动作唤出，出现即聚焦。 */
@Composable
private fun RenameField(draft: String, nameEditor: NameEditor) {
    val focus = remember { FocusRequester() }
    InputField(
        caption = InputCaption.Label(stringResource(R.string.profiles_rename)),
        ground = InputGround.Page,
        value = draft,
        onValueChange = nameEditor::edit,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { nameEditor.commit() }),
        focusRequester = focus,
        // 改的是一个现成的名字：光标接在原名之后，与 Apple 的改名框一致。
        initialCursor = InitialCursor.End,
    )
    LaunchedEffect(focus) { focus.requestFocus() }
}

/** 名称旁的铅笔：字形小，点按区照行内图标列给足 `28`，再由触控目标扩展到 `48`。 */
@Composable
private fun RenameButton(onClick: () -> Unit) {
    val label = stringResource(R.string.profiles_rename)
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(Theme.RowMetrics.iconColumnWidth)
            .clip(Theme.Radius.pill)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
    ) {
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_edit_24_regular),
            contentDescription = null,
            tint = Theme.colors.textSecondary,
            modifier = Modifier.size(PENCIL_GLYPH),
        )
    }
}

/** 用量与到期卡：已用 / 总量（带配额条）、到期与上次更新。行与行之间只靠留白分开。 */
@Composable
private fun ProfileFactsCard(profile: Profile) {
    SettingsGroup(label = null) {
        Column(
            modifier = Modifier.preferenceRowPadding(),
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
        ) {
            Fact(label = stringResource(R.string.usage_used), value = profileUsageDetailOf(profile))
            // 无配额是合法业务态：配额条对 `total <= 0` 是 fail-fast，门控在这里。
            if (profile.totalTraffic > 0) {
                UsageGauge(usedBytes = profile.usedTraffic, totalBytes = profile.totalTraffic)
            }
        }
        Fact(
            label = stringResource(R.string.usage_expiry),
            value = profileExpiryDetailOf(profile),
            modifier = Modifier.preferenceRowPadding(),
        )
        Fact(
            label = stringResource(R.string.profiles_last_updated),
            value = updatedAtLabel(profile.updatedAt),
            modifier = Modifier.preferenceRowPadding(),
        )
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md)) {
        Text(
            text = label,
            style = Theme.Type.rowTitle,
            color = Theme.colors.textPrimary,
            modifier = Modifier.alignByBaseline(),
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = value,
            style = Theme.Type.status.tabular(),
            color = Theme.colors.textSecondary,
            textAlign = TextAlign.End,
            modifier = Modifier.alignByBaseline(),
        )
    }
}

/** 链接可能很长：单独一张卡，任它按宽度折行，不截断；可选中复制。 */
@Composable
private fun ProfileLinkCard(profile: Profile) {
    SettingsGroup(label = null) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Theme.Spacing.lg, vertical = Theme.RowMetrics.verticalPadding),
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
        ) {
            Text(
                text = stringResource(R.string.import_url_label),
                style = Theme.Type.subtitle,
                color = Theme.colors.textSecondary,
            )
            SelectionContainer {
                Text(
                    text = profile.url,
                    style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                    color = Theme.colors.textPrimary,
                )
            }
        }
    }
}

/** 删除单独一张卡，与其余操作隔开。禁用时退出错误色（换一对颜色，不压透明度）。 */
@Composable
private fun DeleteCard(interaction: RowInteraction) {
    val onClick = (interaction as? RowInteraction.Clickable)?.onClick
    val tint = if (onClick == null) Theme.colors.textSecondary else Theme.tones.error.fg
    SettingsGroup(label = null) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm, Alignment.CenterHorizontally),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Theme.RowMetrics.minHeight)
                .clickable(enabled = onClick != null, role = Role.Button) { onClick?.invoke() },
        ) {
            Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_delete_24_regular),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(Theme.RowMetrics.iconSize),
            )
            Text(
                text = stringResource(R.string.delete),
                style = Theme.Type.rowTitle.copy(fontWeight = FontWeight.Medium),
                color = tint,
            )
        }
    }
}

private val PENCIL_GLYPH = 16.dp
