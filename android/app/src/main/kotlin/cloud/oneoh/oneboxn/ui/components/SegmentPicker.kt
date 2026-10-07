package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.shadowThumb

// 分段选择器：轨 `segmentTrack` 填充 + `Radius.pill`，
// **选中段**取 `controlRaised` 填充 + `shadowThumb` + 同样的 `pill`。
//
// 本端没有一个会平移的滑块：要的是选中位置的转移，不规定机制；
// 段宽相等 ⇒ 「只有选中段有滑块」在视觉上等价于滑块在段之间滑动。
//
// 滑块**不能用 `surface`**：那在明亮态成立而暗色整个翻过来（`surface` #1C1C1E 比轨 #323236 更暗，
// 选中段会陷下去而不是浮起）。`controlRaised` 就是为了同时满足两个主题才立的令牌。
//
// 取 M3 的分段按钮行而**不取 `PrimaryTabRow`**：后者的选中指示器是一条下划线，
// 而分段控件与其滑块同属 `pill` 家族，下划线不在这套形状里（也不许用线条建立层级）。
//
// 仍然用平台的分段件而不自绘：命中区、旁白的 selected 特征与键盘遍历都已经由它做好，
// 自绘等于把这三样重做一遍。外观则按上面的取值显式覆写——描边归零、选中段自带圆角。
@Composable
fun <T> SegmentPicker(
    options: List<Pair<T, String>>,
    selection: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    require(options.isNotEmpty()) { "SegmentPicker requires at least one option" }
    val haptics = LocalHapticFeedback.current

    // M3 给每段补到 48 的最小触控尺寸，补在段外：选中块上下就比左右多出一截，四边内衬不再相等。
    // 轨本身就是触控面（40 高、段宽远大于 40），关掉这层补齐，几何全由 `SegmentMetrics` 定。
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
        SingleChoiceSegmentedButtonRow(
            // space = 0：M3 默认留负间距好让相邻描边合成一条，而这里根本不画描边。
            space = 0.dp,
            modifier = modifier
                .fillMaxWidth()
                .height(SegmentMetrics.TRACK_HEIGHT)
                .background(Theme.colors.segmentTrack, Theme.Radius.pill)
                // 段与选中块同在内衬之内均分：选中块四边离轨内缘恒为同一个内衬。
                .padding(SegmentMetrics.INSET),
        ) {
            options.forEach { (value, title) ->
                val selected = value == selection
                SegmentedButton(
                    selected = selected,
                    onClick = {
                        // 重绘写回同一个值既不发触觉也不回调，否则每次重组都多一次持久化与重连。
                        if (!selected) {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onSelect(value)
                        }
                    },
                    shape = Theme.Radius.pill,
                    colors = SegmentedButtonDefaults.colors(
                        activeContainerColor = Theme.colors.controlRaised,
                        activeContentColor = Theme.colors.textPrimary,
                        activeBorderColor = Color.Transparent,
                        inactiveContainerColor = Color.Transparent,
                        inactiveContentColor = Theme.colors.textSecondary,
                        inactiveBorderColor = Color.Transparent,
                    ),
                    border = BorderStroke(0.dp, Color.Transparent),
                    // 默认的对勾图标会把标签挤到一边、也让两段宽度随选中态变化；
                    // 滑块位置本身已经是颜色之外的第二通道。
                    icon = {},
                    label = {
                        Text(
                            text = title,
                            style = Theme.Type.status,
                            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
                        )
                    },
                    modifier = Modifier
                        .height(SegmentMetrics.THUMB_HEIGHT)
                        .then(if (selected) Modifier.shadowThumb(Theme.Radius.pill) else Modifier),
                )
            }
        }
    }
}

/**
 * 分段控件的几何账：轨高与内衬定死，
 * 段宽由轨宽均分**内衬之内**的那一段 ⇒ 选中块四边离轨内缘恒为同一个内衬，首尾段也一样。
 */
internal data class SegmentMetrics(val trackWidth: Dp, val count: Int) {
    val segmentWidth: Dp get() = (trackWidth - INSET * 2) / count

    /** 第 [index] 段选中块的左沿（自轨左沿量起）。 */
    fun thumbX(index: Int): Dp = INSET + segmentWidth * index

    companion object {
        /** 整条轨的高。 */
        val TRACK_HEIGHT = 40.dp

        /** 轨与选中块之间的内衬：同心圆角靠它成立。 */
        val INSET = 2.dp
        val THUMB_HEIGHT = TRACK_HEIGHT - INSET * 2
    }
}
