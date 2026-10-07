package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import cloud.oneoh.oneboxn.ui.Theme
import androidx.compose.ui.text.style.TextOverflow

// 操作卡里的一行：`28` 图标列 + `15` 标签，整条为 `accent`（「文字操作」形态）。
// 不带 chevron、不进子层——它执行一个动作，不是导航。
//
// 承载它的卡是 `SettingsGroup(label = null)`，与设置页的分组卡同一件，不另造一个只换了名字的容器。

/** 一条操作行的全部内容：标签与图标说的是同一行的同一件事，聚成一个描述。 */
@Immutable
data class ActionItem(val label: String, val icon: Int)

/**
 * [interaction] 说清这一行此刻能不能点：[RowInteraction.Disabled] 时**退出强调色**（换一对颜色，不压透明度），
 * 且仍报成「一个被禁用的按钮」（理由同 `SettingsRow` 的禁用行）。
 */
@Composable
fun ActionRow(item: ActionItem, interaction: RowInteraction) {
    val onClick = (interaction as? RowInteraction.Clickable)?.onClick
    val tint = if (interaction == RowInteraction.Disabled) Theme.colors.textSecondary else Theme.colors.accent
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Theme.RowMetrics.minHeight)
            .then(
                when {
                    onClick != null -> Modifier.clickable(role = Role.Button, onClick = onClick)
                    interaction == RowInteraction.Disabled -> Modifier.semantics {
                        role = Role.Button
                        disabled()
                    }
                    else -> Modifier
                },
            )
            .padding(horizontal = Theme.Spacing.lg, vertical = Theme.Spacing.md),
    ) {
        Box(Modifier.size(Theme.RowMetrics.iconColumnWidth), contentAlignment = Alignment.Center) {
            Icon(
                painter = painterResource(item.icon),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(Theme.RowMetrics.iconSize),
            )
        }
        Text(
            text = item.label,
            style = Theme.Type.rowTitle,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
