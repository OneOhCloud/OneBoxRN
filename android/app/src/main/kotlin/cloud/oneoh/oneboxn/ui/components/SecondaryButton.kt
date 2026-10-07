package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.Tone

// 次操作按钮：默认 `fill` 填充 + `textPrimary` 前景（柔和填充，禁描边）。
// 前景**不用 `accent`**：暗色下 `accent` 压 `fill` 只有 `3.50:1`。
// iOS 对等物是 Components/SecondaryButtonStyle。
//
// `tone` 存在是因为失败弹层「复制详情」写入无可检测失败后要切成功对。
// **不要把它开成「任意上色」**：只有两种用法——默认色对与破坏性语义的错误对。
@Composable
fun SecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: Painter? = null,
    tone: Tone = Theme.secondaryAction,
) {
    Button(
        onClick = onClick,
        contentPadding = ButtonMetrics.padding,
        modifier = modifier.height(ButtonMetrics.height),
        shape = ButtonMetrics.shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = tone.container,
            contentColor = tone.fg,
        ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
        ) {
            if (icon != null) TextHeightGlyph(painter = icon, textStyle = Theme.Type.control)
            Text(text = label, style = Theme.Type.control)
        }
    }
}
