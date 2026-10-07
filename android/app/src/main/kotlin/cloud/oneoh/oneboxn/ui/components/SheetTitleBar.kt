package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import com.microsoft.fluent.mobile.icons.R as FluentR

private val TITLE_BAR_HEIGHT = 44.dp
private val CLOSE_BUTTON_SIZE = 28.dp

/**
 * 「给内容」弹层的标题条（关于、配置详情；Apple 对等物 `ContentModalTitleBar`）：
 * `44` 高、`15/600` 居中、右上角 `28` 圆形关闭键；**不画下边线**。标题条自带关闭键，弹层不再摆横杆。
 */
@Composable
fun SheetTitleBar(title: String, onClose: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxWidth().height(TITLE_BAR_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = title,
            // 弹层紧凑标题条是 `15/600`。不借 `sheetTitle`（`16/600` 的弹层标题）的字重：
            // 借名会让改 `sheetTitle` 字重的人静默改掉一个与它无关的标题条。
            style = Theme.Type.rowTitle.copy(fontWeight = FontWeight.SemiBold),
            color = Theme.colors.textPrimary,
        )
        // M3 的最小触控尺寸会把键的版式撑到 `48`，圆底跟着画成 `48`、顶出 `44` 的标题条；
        // 关掉它，圆画回 `28`，点按区由触控目标扩展给足，不进版式。
        CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
            IconButton(
                onClick = onClose,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .size(CLOSE_BUTTON_SIZE)
                    .background(Theme.colors.fill, Theme.Radius.pill),
            ) {
                Icon(
                    painter = painterResource(FluentR.drawable.ic_fluent_dismiss_24_regular),
                    contentDescription = stringResource(R.string.back),
                    tint = Theme.colors.textSecondary,
                    // 键内图标字形 `18`：角色是「弹层关闭键」，与行图标槽那个 `22` 是两个角色两个值。
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}
