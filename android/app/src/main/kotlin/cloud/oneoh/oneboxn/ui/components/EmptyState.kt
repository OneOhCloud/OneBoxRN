package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Theme

// 空态：说明原因 + 给出下一步；静态呈现，入场无动画。
// 无操作的空态（如 Logs）省略 actionLabel/onAction。
//
// **水平边距由调用方给，本组件一份都不加**（水平边距 = 该页的页边距）：
// 页边距是**页级**关切，同页其它元素都已由页容器供给，空态只是页上的又一个元素
// —— 它不该持有第二份。
//
// 没有判据守「调用点记得给」：漏给的后果是空态比同页内容宽 16，而它在默认字号下看不出来
// （所有子项都被 `240` 上界或内容宽兜住，谁都够不到边）。
@Composable
fun EmptyState(
    icon: Painter,
    title: String,
    caption: String,
    /** 水平页边距由此进来（见文件头）：调用方给，或由已经带页边距的祖先容器供给。 */
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    require((actionLabel == null) == (onAction == null)) { "actionLabel and onAction must be provided together" }
    Column(
        // **占满剩余视口并在其中垂直居中**（不套固定最小高的盒子）；元素间距 16。
        // **水平边距不在这里**，见文件头。
        // 居中靠的是 `fillMaxSize` + `Alignment.CenterVertically` 两件配合，**缺一件就贴顶**。
        // 不要改成 `fillMaxWidth()`：多数调用点的父容器给的是**有界**高度（`Box(fillMaxSize)`、
        // `Scaffold` 内容 lambda、`weight(1f)`），`fillMaxHeight` 那一半在那里正是承重的。
        modifier = modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.lg, Alignment.CenterVertically),
    ) {
        Box(
            modifier = Modifier
                .size(ICON_TILE_SIZE)
                .background(
                    Theme.colors.accentContainer,
                    RoundedCornerShape(Theme.Radius.panel),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = icon,
                contentDescription = null,
                tint = Theme.colors.accent,
                modifier = Modifier.size(ICON_SIZE),
            )
        }
        Text(text = title, style = Theme.Type.emptyTitle)
        Text(
            text = caption,
            style = Theme.Type.status,
            color = Theme.colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = CAPTION_MAX_WIDTH),
        )
        if (actionLabel != null && onAction != null) {
            // 空态 CTA 与主按钮同形，不另立一套胶囊。
            // `widthIn(max = …)` 留着：贴合内容只是不主动铺满，**长文案仍要有上界**，
            // 否则超长标签会把按钮撑过页边距（与说明文字共用同一个 `240` 上界）。
            PrimaryButton(
                label = actionLabel,
                onClick = onAction,
                modifier = Modifier.widthIn(max = CAPTION_MAX_WIDTH),
            )
        }
    }
}

private val ICON_TILE_SIZE = 64.dp
private val ICON_SIZE = 30.dp
private val CAPTION_MAX_WIDTH = 240.dp
