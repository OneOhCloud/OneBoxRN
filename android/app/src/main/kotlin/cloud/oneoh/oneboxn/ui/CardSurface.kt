package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp

/**
 * 分组卡的外观：`surface` 填充 + 圆角，两件一起给。卡是平的：不描边、不投影、不画渐变——
 * 卡与页的填充差只有 `1.07` / `1.23`，页面的层次由页顶晕染（`screenBackground`）补上。
 *
 * `radius` 默认 `card 14`（内部只有文本行的容器）；内部嵌了带底色圆角块的容器传 `panel 18`，
 * 好让同心式「内层 = 外层 − 内衬 6」成立（`18 − 6 = 12`）。
 */
@Composable
fun Modifier.cardSurface(radius: Dp = Theme.Radius.card): Modifier {
    val shape = RoundedCornerShape(radius)
    return background(Theme.colors.surface, shape)
}
