package cloud.oneoh.oneboxn.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.ui.Motion
import cloud.oneoh.oneboxn.ui.ProfilesViewModel
import cloud.oneoh.oneboxn.ui.QuotaState
import cloud.oneoh.oneboxn.ui.SecondaryTextSurface
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.motionSpec
import cloud.oneoh.oneboxn.ui.profileUsageOf
import cloud.oneoh.oneboxn.ui.quotaState
import cloud.oneoh.oneboxn.ui.tabular
import com.microsoft.fluent.mobile.icons.R as FluentR

// 配置列表的一行：单选圈 · 名称 / 用量 · 本机用量入口。点行即切换为当前配置。
//
// 详情、刷新、删除收在长按菜单里：行尾已经有用量入口，再并排一枚菜单图标就分不清哪个是用量、
// 哪个是菜单；删除也本不该一眼可见。

/** 一行能触发的全部动作。聚成一个值：五个并列回调在调用点读不出哪个是哪个。 */
@Immutable
data class ProfileRowHandlers(
    val activate: () -> Unit,
    val openUsage: () -> Unit,
    val showDetail: () -> Unit,
    val refresh: () -> Unit,
    val delete: () -> Unit,
)

@Composable
fun ProfileRow(profile: Profile, state: ProfilesViewModel.RowState, handlers: ProfileRowHandlers) {
    val (isActive, isBusy) = state
    val activeState = stringResource(R.string.profiles_active)
    var menuOpen by remember { mutableStateOf(false) }
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    // 当前项常驻 `accentContainer` 且不叠按下：它已是当前项，点它什么也不发生。
    val rowFill by animateColorAsState(
        targetValue = when {
            isActive -> Theme.colors.accentContainer
            pressed && !isBusy -> Theme.colors.rowActive
            else -> Color.Transparent
        },
        animationSpec = motionSpec(Motion.ROW_MS),
        label = "profileRowFill",
    )
    // 激活行整块铺 `accentContainer`，而 `textSecondary` 压它亮色只有 `4.30` ⇒ 次级墨色随底升档。
    val secondaryInk = Theme.secondaryText(
        on = if (isActive) SecondaryTextSurface.AccentContainer else SecondaryTextSurface.Plain,
        colors = Theme.colors,
    )
    // 长按菜单挂在这一层：菜单从这一行下方弹出，指着的就是它。
    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                // 行内缩在卡里、四角露在卡内 ⇒ 底带 `control` 圆角（卡 `panel 18` − 内衬 `6`，同心）。
                .clip(RoundedCornerShape(Theme.Radius.control))
                .background(rowFill)
                // **忙碌不压透明度**：名称、用量全是数据，压暗丢的是那几个数本身。
                // 标题在忙碌时已整句换成「刷新中…」，加上同一拍的禁用，「在途」已经说清楚了。
                // 忙碌行的长按照样开菜单（看详情），只是刷新与删除不可点。
                .combinedClickable(
                    interactionSource = interactionSource,
                    indication = null,
                    role = Role.Button,
                    onClick = { if (!isBusy) handlers.activate() },
                    onLongClick = { menuOpen = true },
                )
                // `selected` 在 Compose 里映射到 `isChecked`（角色不是 Tab 时），读屏于是念
                // 「已勾选」——那**暗示一个可勾可取消的复选框**，而当前配置是单选互斥的。
                // 故另给 `stateDescription` 说真话。
                .semantics {
                    selected = isActive
                    if (isActive) stateDescription = activeState
                }
                // 行内文字相对卡内衬再内缩：`6 + 10 = 16`，与页面读字边距对齐；
                // 行尾只让出 `4`：用量入口自带点按框，图标离卡沿的呼吸由那个框给。
                .padding(start = Theme.Spacing.textInset, end = TRAILING_INSET),
        ) {
            ProfileRadio(state = if (isActive) RadioState.On else RadioState.Off)
            Column(
                verticalArrangement = Arrangement.spacedBy(STACK_GAP),
                modifier = Modifier.weight(1f).padding(vertical = Theme.Spacing.sm),
            ) {
                TitleLine(profile = profile, state = state)
                Text(
                    text = profileUsageOf(profile),
                    style = Theme.Type.subtitle.tabular(),
                    color = secondaryInk,
                    // 无障碍字号下不锁单行：用量那一行在大字号下会被截掉后半段，而那半正是百分比。
                    maxLines = if (Theme.isAccessibilityFontScale) Int.MAX_VALUE else 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            UsageEntry(tint = secondaryInk, onClick = handlers.openUsage)
        }
        ProfileRowMenu(
            menu = RowMenu(
                expanded = menuOpen,
                state = if (isBusy) MenuState.Busy else MenuState.Idle,
                onDismiss = { menuOpen = false },
            ),
            handlers = handlers,
        )
    }
}

@Composable
private fun TitleLine(profile: Profile, state: ProfilesViewModel.RowState) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = if (state.isBusy) stringResource(R.string.profiles_refreshing) else profile.name,
            style = Theme.Type.rowTitle.copy(fontWeight = FontWeight.Medium),
            // 用尽时名称转错误色，**而激活行例外**：那一行整块铺 `accentContainer`，`error.fg` 压它
            // 明 4.27 / 暗 3.68，两态都不过文字门槛；当前配置的超额信号由摘要卡的配额条与用量行的
            // 「已用尽」承担。
            color = if (quotaState(profile) == QuotaState.EXCEEDED && !state.isActive) {
                Theme.tones.error.fg
            } else {
                Theme.colors.textPrimary
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        state.outcome?.let { OutcomePill(it) }
    }
}

/** 单选圈的两态。用枚举而不是布尔：调用点写 `RadioState.On` 读得出是哪一态，写 `true` 读不出。 */
private enum class RadioState { On, Off }

/**
 * 单选圈。**实心勾是「当前配置」的非颜色通道**：选中底之外还得有一枚形状在变，
 * 否则当前项只靠一层浅色底区分。
 */
@Composable
private fun ProfileRadio(state: RadioState) {
    Box(Modifier.width(GLYPH_COLUMN), contentAlignment = Alignment.Center) {
        when (state) {
            RadioState.On -> Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(RADIO_DIAMETER)
                    .background(Theme.colors.accent, Theme.Radius.pill),
            ) {
                Icon(
                    painter = painterResource(FluentR.drawable.ic_fluent_checkmark_24_regular),
                    contentDescription = null,
                    tint = Theme.colors.onAccent,
                    modifier = Modifier.size(RADIO_CHECK_SIZE),
                )
            }
            RadioState.Off -> Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_circle_24_regular),
                contentDescription = null,
                tint = Theme.colors.textSecondary,
                modifier = Modifier.size(GLYPH_COLUMN),
            )
        }
    }
}

/** 行尾的本机用量入口：叠在行底之上，不另铺底。 */
@Composable
private fun UsageEntry(tint: Color, onClick: () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(USAGE_ENTRY_SIDE)
            .clip(Theme.Radius.pill)
            .clickable(role = Role.Button, onClick = onClick),
    ) {
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_data_trending_24_regular),
            contentDescription = stringResource(R.string.settings_usage),
            tint = tint,
            modifier = Modifier.size(USAGE_GLYPH_SIZE),
        )
    }
}

/** 菜单里刷新与删除可不可点。用枚举而不是布尔：调用点写 `MenuState.Busy` 读得出是哪一态，写 `true` 读不出。 */
private enum class MenuState { Idle, Busy }

/** 菜单此刻的呈现：开没开、可点的范围、怎么收起。 */
private data class RowMenu(val expanded: Boolean, val state: MenuState, val onDismiss: () -> Unit)

/** 菜单项的语义：删除取错误色，其余取正文色。 */
private enum class EntryTone { Neutral, Destructive }

private data class RowMenuEntry(val label: Int, val icon: Int, val tone: EntryTone)

/**
 * 长按菜单：详情 · 刷新 · 删除。
 * 刷新在途时刷新与删除都不可点：删掉一份正在写回的配置，写回落空也不会有任何反馈。
 */
@Composable
private fun ProfileRowMenu(menu: RowMenu, handlers: ProfileRowHandlers) {
    DropdownMenu(expanded = menu.expanded, onDismissRequest = menu.onDismiss) {
        val detail = RowMenuEntry(R.string.profiles_detail, FluentR.drawable.ic_fluent_info_24_regular, EntryTone.Neutral)
        MenuItem(detail, MenuState.Idle) {
            menu.onDismiss()
            handlers.showDetail()
        }
        val refresh = RowMenuEntry(
            R.string.profiles_refresh,
            FluentR.drawable.ic_fluent_arrow_clockwise_24_regular,
            EntryTone.Neutral,
        )
        MenuItem(refresh, menu.state) {
            menu.onDismiss()
            handlers.refresh()
        }
        val delete = RowMenuEntry(R.string.delete, FluentR.drawable.ic_fluent_delete_24_regular, EntryTone.Destructive)
        MenuItem(delete, menu.state) {
            menu.onDismiss()
            handlers.delete()
        }
    }
}

@Composable
private fun MenuItem(entry: RowMenuEntry, state: MenuState, onClick: () -> Unit) {
    val tint = when (entry.tone) {
        EntryTone.Neutral -> Theme.colors.textPrimary
        EntryTone.Destructive -> Theme.tones.error.fg
    }
    DropdownMenuItem(
        text = { Text(stringResource(entry.label), style = Theme.Type.control.copy(fontWeight = FontWeight.Normal)) },
        leadingIcon = {
            Icon(painterResource(entry.icon), contentDescription = null, modifier = Modifier.size(MENU_ICON_SIZE))
        },
        enabled = state == MenuState.Idle,
        colors = MenuDefaults.itemColors(
            textColor = tint,
            leadingIconColor = tint,
            disabledTextColor = Theme.colors.textSecondary,
            disabledLeadingIconColor = Theme.colors.textSecondary,
        ),
        onClick = onClick,
    )
}

/** 结局药丸（成功 / 失败两语义），`5s` 后由 ViewModel 自动清除。 */
@Composable
private fun OutcomePill(outcome: ProfilesViewModel.RowOutcome) {
    val tone = when (outcome) {
        ProfilesViewModel.RowOutcome.SUCCESS -> Theme.tones.success
        ProfilesViewModel.RowOutcome.FAILED -> Theme.tones.error
    }
    Text(
        text = stringResource(
            when (outcome) {
                ProfilesViewModel.RowOutcome.SUCCESS -> R.string.profiles_refresh_done
                ProfilesViewModel.RowOutcome.FAILED -> R.string.profiles_refresh_failed
            },
        ),
        style = Theme.Type.badge,
        color = tone.fg,
        modifier = Modifier
            .background(tone.container, RoundedCornerShape(Theme.Radius.chip))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/** 列表卡的最后一行：导入配置。与配置行同一列起字、同一种行底。 */
@Composable
fun ProfileImportRow(onClick: () -> Unit) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val rowFill by animateColorAsState(
        targetValue = if (pressed) Theme.colors.rowActive else Color.Transparent,
        animationSpec = motionSpec(Motion.ROW_MS),
        label = "profileImportRowFill",
    )
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Theme.RowMetrics.minHeight)
            .clip(RoundedCornerShape(Theme.Radius.control))
            .background(rowFill)
            .clickable(interactionSource = interactionSource, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = Theme.Spacing.textInset),
    ) {
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_add_circle_24_regular),
            contentDescription = null,
            tint = Theme.colors.accent,
            modifier = Modifier.size(GLYPH_COLUMN),
        )
        Text(
            text = stringResource(R.string.profiles_import),
            style = Theme.Type.rowTitle.copy(fontWeight = FontWeight.Medium),
            color = Theme.colors.accent,
        )
    }
}

/** 行最小高：两行文字（名称 + 用量）再加上下呼吸，比单行的设置行高一档。 */
private val ROW_MIN_HEIGHT = 60.dp
private val STACK_GAP = 2.dp
private val TRAILING_INSET = 4.dp

/** 单选圈与导入加号共用的图标列：两种行的文字从同一条竖线起。字形在 `24` 格里占 `20`。 */
private val GLYPH_COLUMN = 24.dp
private val RADIO_DIAMETER = 20.dp
private val RADIO_CHECK_SIZE = 14.dp
private val USAGE_ENTRY_SIDE = 40.dp
private val USAGE_GLYPH_SIZE = 20.dp
private val MENU_ICON_SIZE = 20.dp
