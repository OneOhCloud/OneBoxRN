package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import cloud.oneoh.oneboxn.ui.Theme

// 弱操作按钮：sheet 里的「取消」这类退出动作，与次操作同底同形但更弱。
// iOS 对等物是 Components/SecondaryButtonStyle.swift 里的 QuietButtonStyle。
//
// 与 SecondaryButton 的差异：前景用 textSecondary、字重钉 FontWeight.Normal、没有 icon、可被禁用。
// 层级只来自填充与排版，没有描边。
@Composable
fun QuietButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        contentPadding = ButtonMetrics.padding,
        modifier = modifier.height(ButtonMetrics.height),
        shape = ButtonMetrics.shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = Theme.colors.fill,
            contentColor = Theme.colors.textSecondary,
        ),
    ) {
        Text(
            text = label,
            style = Theme.Type.control,
            fontWeight = FontWeight.Normal,
        )
    }
}
