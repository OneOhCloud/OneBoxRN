package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Theme

/**
 * 主 / 次 / 弱三种按钮共用的外形：胶囊、可见高 `40`、宽度贴合内容，文字与端头之间左右各留 `20`（与 Apple 同值）。
 * 外形只在这里定，调用点不加宽度修饰；排布交给 [ButtonRow]。
 */
internal object ButtonMetrics {
    val shape = Theme.Radius.pill

    val padding = PaddingValues(horizontal = 20.dp, vertical = 0.dp)

    // 画出来的高恒为 40。Android 的最小触控区 48 不靠把胶囊画大来满足：命中区靠布局让出，不改视觉高度。
    val height = 40.dp
}

// 实心主按钮（iOS 对等物 Components/PrimaryButtonStyle）。
// 每个可见任务区域最多一个；按压反馈用 M3 ripple（允许的平台差异，替代 iOS 85% 透明）。
// 没有禁用态：输入不合法时由调用点在点击后就地报错，不靠置灰表达「现在不能提交」。
@Composable
fun PrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        onClick = onClick,
        contentPadding = ButtonMetrics.padding,
        modifier = modifier.height(ButtonMetrics.height),
        shape = ButtonMetrics.shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = Theme.colors.accent,
            contentColor = Theme.colors.onAccent,
        ),
    ) {
        Text(text = label, style = Theme.Type.control.copy(fontWeight = FontWeight.SemiBold))
    }
}
