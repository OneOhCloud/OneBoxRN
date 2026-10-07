package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import cloud.oneoh.oneboxn.ui.Theme

/**
 * 弹层与页面的按钮行（Apple 对等物 `ButtonRow`）：贴合内容的按钮靠尾部排成一行，左弱右主，与系统对话框同一惯例。
 * 主操作落在视线与拇指的终点；单颗按钮的居中由调用方的容器决定，不经本行。
 *
 * [leading] 放辅助操作（重置、删除、换一种输入方式）：贴前缘，与尾部那一组至少隔 `lg`——
 * 它与「取消 / 确定」不是同级选择。一行放不下时辅助操作换到上一行前缘，尾部那一组不拆。
 */
@Composable
fun ButtonRow(
    modifier: Modifier = Modifier,
    leading: @Composable RowScope.() -> Unit = {},
    trailing: @Composable RowScope.() -> Unit,
) {
    Layout(
        contents = listOf({ ButtonGroup(leading) }, { ButtonGroup(trailing) }),
        modifier = modifier,
    ) { (leadingSlot, trailingSlot), constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val start = leadingSlot.firstOrNull()?.measure(loose)
        val end = trailingSlot.first().measure(loose)
        val width = if (constraints.hasBoundedWidth) constraints.maxWidth else (start?.width ?: 0) + end.width
        val gap = Theme.Spacing.lg.roundToPx()
        val stacked = start != null && start.width > 0 && start.width + gap + end.width > width
        val rowGap = if (stacked) Theme.Spacing.sm.roundToPx() else 0
        val startHeight = start?.height ?: 0
        val height = if (stacked) startHeight + rowGap + end.height else maxOf(startHeight, end.height)
        layout(width, height) {
            if (stacked) {
                start?.place(0, 0)
                end.place(width - end.width, startHeight + rowGap)
            } else {
                start?.place(0, (height - startHeight) / 2)
                end.place(width - end.width, (height - end.height) / 2)
            }
        }
    }
}

@Composable
private fun ButtonGroup(content: @Composable RowScope.() -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}
