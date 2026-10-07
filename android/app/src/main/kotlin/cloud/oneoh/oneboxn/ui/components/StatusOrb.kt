package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// 状态圆盘：圆形语义容器 + 语义前景图标。
// 纯展示；状态含义必须由同屏文字表达（不只靠颜色与图形），故图标不带无障碍描述。
@Composable
fun StatusOrb(
    icon: Painter,
    tint: Color,
    container: Color,
    modifier: Modifier = Modifier,
    size: OrbSize = OrbSize.Hero,
) {
    Box(
        modifier = modifier
            .size(size.diameter)
            .background(container, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(size.glyph),
        )
    }
}

/** 圆盘的两档（与 Apple 同值）。 */
enum class OrbSize(val diameter: Dp, val glyph: Dp) {
    /** 整屏只讲这一件事（扫码权限、配置合并失败）：圆盘自己就是主角。 */
    Hero(88.dp, 34.dp),

    /** 导入页页顶的结论圆盘：下面还有配置卡与按钮，圆盘只起头。 */
    Header(64.dp, 28.dp),
}
