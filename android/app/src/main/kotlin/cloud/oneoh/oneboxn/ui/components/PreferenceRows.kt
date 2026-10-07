package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Theme
import com.microsoft.fluent.mobile.icons.R as FluentR

// 取值行：行尾显示当前值，点开是系统的下拉菜单（Material 的 exposed dropdown），就地列出几个互斥取值、
// 选中即持久化。设置页的路由模式 / 区域 / 内核行与参数页的缺省来源行是同一种交互。
//
// 菜单挂在整行上、从这一行下方展开，宽与行同；键盘、读屏、弹出与收起由系统件给。
// 暂不开放的取值照常列出、不可选（禁用是取值本身的属性，不是行的状态）；当前值带对勾。
// 右侧 chevron_up_down 与推入行 chevron_right、外链行 arrow_up_right 三分语义。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> MenuRow(
    label: String,
    options: List<Triple<T, String, Boolean>>,
    selection: T,
    onSelect: (T) -> Unit,
    icon: Int?,
    iconFamily: SettingsIconFamily = SettingsIconFamily.Informational,
    // 见 `SettingsRow.titleMaxLines`。给 2 时值改为贴合内容（不再占半栏），标题拿剩下的宽度先折行。
    titleMaxLines: Int = 1,
) {
    var expanded by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        SettingsRow(
            label = label,
            interaction = RowInteraction.Clickable { expanded = true },
            // 锚点只管定位：点按由行自己的可点语义接，读屏上这一行仍是一个控件，不是两个。
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = false),
            icon = icon,
            iconFamily = iconFamily,
            titleMaxLines = titleMaxLines,
        ) {
            // **值不许无限拿宽度**：`Row` 先量无权重子项、剩下的才给标签那栏的 `weight(1f)`，
            // 于是长值会把标签挤到几乎没有——大字号下「Region」会被从词中间断开。
            // 占满半栏再右对齐：普通档值仍贴着上下箭头，大字号下标签也拿得到另一半。
            Text(
                text = options.first { it.first == selection }.second,
                style = Theme.Type.status,
                color = Theme.colors.textSecondary,
                textAlign = TextAlign.End,
                modifier = if (titleMaxLines > 1) Modifier else Modifier.weight(1f),
            )
            Spacer(Modifier.width(6.dp))
            Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_chevron_up_down_24_regular),
                contentDescription = null,
                tint = Theme.colors.textSecondary,
                modifier = Modifier.size(Theme.RowMetrics.trailingIconSize),
            )
        }
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for ((value, title, available) in options) {
                DropdownMenuItem(
                    text = { Text(title, style = Theme.Type.control.copy(fontWeight = FontWeight.Normal)) },
                    // 勾恒占位：未选中项留一个等大的空位，各项文字的截断点不随选中项移动。
                    trailingIcon = {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_checkmark_24_regular),
                            contentDescription = null,
                            tint = if (value == selection) Theme.colors.accent else Color.Transparent,
                            modifier = Modifier.size(MENU_CHECK_SIZE),
                        )
                    },
                    enabled = available,
                    colors = MenuDefaults.itemColors(
                        textColor = Theme.colors.textPrimary,
                        disabledTextColor = Theme.colors.textSecondary,
                    ),
                    // 幂等：选已选中项只收起，不重新持久化、不触发配置热重载。
                    onClick = {
                        expanded = false
                        if (value != selection) {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onSelect(value)
                        }
                    },
                )
            }
        }
    }
}

/** 开关行的全部内容：标签、图标与副标题说的是同一行的同一件事，聚成一个描述。 */
@Immutable
data class ToggleItem(
    val label: String,
    val icon: Int,
    val isOn: Boolean,
    /** 说明这个开关到底做了什么；不锁单行——解释被截断就永远看不到（开关行没有下一屏）。 */
    val subtitle: String? = null,
    val iconFamily: SettingsIconFamily = SettingsIconFamily.Informational,
)

/**
 * 开关行：行尾是系统开关，就地切换、即时生效。整行可点，不带 chevron——开关自身即控件。
 *
 * 用 `toggleable` 而不是 `clickable`：前者把整行**合并**成一个 `Role.Switch` 语义节点，
 * 读屏念一次；后者会让行与开关各报一次。配套：`Switch` 的 `onCheckedChange` 置 `null`，
 * 否则它自己还接一遍点击，既重复响应也会把自己重新报成一个独立的可点节点。
 */
@Composable
fun ToggleRow(item: ToggleItem, onToggle: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = item.isOn, onValueChange = onToggle, role = Role.Switch)
            .preferenceRowPadding(),
    ) {
        SettingsIconColumn(icon = item.icon, family = item.iconFamily)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = item.label,
                style = Theme.Type.rowTitle,
                color = Theme.colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            item.subtitle?.let {
                Text(text = it, style = Theme.Type.subtitle, color = Theme.colors.textSecondary)
            }
        }
        Spacer(Modifier.padding(horizontal = 6.dp))
        Switch(checked = item.isOn, onCheckedChange = null)
    }
}

private val MENU_CHECK_SIZE = 16.dp
