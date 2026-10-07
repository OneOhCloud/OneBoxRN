package cloud.oneoh.oneboxn.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import cloud.oneoh.oneboxn.ui.AppColors
import cloud.oneoh.oneboxn.ui.Theme

/**
 * 弹层面板的底色取哪一个令牌，**判准写在名字里**：弹层必须呈现至少一个 `surface` 面。
 *
 * 暗色的 `background` 是纯黑，被遮罩压暗的页面也是纯黑 ⇒ **任何压在黑上的黑色手段贡献都为零**
 * （面板与压暗页面对比 `1.000`）。故这一档不是配色偏好，是「这个面板还看不看得见」。
 *
 * **不做成布尔开关，也不留默认值**：一个多数场合恰好正确的默认，比一处明显的错更难发现。
 * 具名两档之后，每个调用点都得自己说清站在判准的哪一侧。
 */
enum class SheetPanel {
    /** 面板上有 `surface` 卡片：面板取 `background`，边界由卡片承担。 */
    GroupedCards,

    /** 面板上没有卡片：面板自己取 `surface`，否则暗色下读起来是一堆浮空的文字。 */
    PlainPanel,
}

/** 纯函数形态：两档各取哪个令牌，可直接单测，不必起 Compose。 */
internal fun SheetPanel.color(colors: AppColors): Color = when (this) {
    SheetPanel.GroupedCards -> colors.background
    SheetPanel.PlainPanel -> colors.surface
}

@Composable
fun SheetPanel.color(): Color = color(Theme.colors)
