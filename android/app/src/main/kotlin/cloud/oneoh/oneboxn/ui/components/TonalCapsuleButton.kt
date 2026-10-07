package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Theme

/**
 * 浅色胶囊按钮（Apple 对等物 `TonalCapsuleButtonStyle`）：`accentContainer` 底、`textPrimary` 前景、
 * 可见高 `32`、左右 `16`。回到顶部、回到最新、配置详情头部的主机名胶囊、关于弹层版本行的更新胶囊共用这一件。
 *
 * 前景取 `textPrimary` 而非 `accent`：`accent` 压 `accentContainer` 在暗色下只有 `3.44:1`。
 * 命中区由 M3 的最小触控尺寸让出，不改可见高度。内容横排、垂直居中、相邻两件隔 `sm`；
 * 图标用 [TextHeightGlyph]，在文字前还是后是各处自己的事。
 *
 * 禁用态换成 `fill` + `textSecondary` 那一对颜色，不整层压透明度。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TonalCapsuleButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = Theme.Radius.pill,
        color = if (enabled) Theme.colors.accentContainer else Theme.colors.fill,
        contentColor = if (enabled) Theme.colors.textPrimary else Theme.colors.textSecondary,
        modifier = modifier.height(CAPSULE_HEIGHT),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Theme.Spacing.lg),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
            content = content,
        )
    }
}

/**
 * 胶囊与按钮里的图标（Fluent `24` 网格）：满高字形（圆圈类）与同排文字（[textStyle]，缺省为胶囊的 `status` 档）里的汉字等高，
 * 与文字垂直居中。尺寸与下移量都从字号推出，随系统字体缩放；转动等效果由调用方经 [modifier] 挂在这块正方形上，轴心即字形中心。
 */
@Composable
fun TextHeightGlyph(painter: Painter, modifier: Modifier = Modifier, textStyle: TextStyle = Theme.Type.status) {
    val textSize = textStyle.fontSize
    val density = LocalDensity.current
    Icon(
        painter = painter,
        contentDescription = null,
        modifier = Modifier
            .offset(y = with(density) { (textSize * GLYPH_DROP_EM).toDp() })
            .size(with(density) { (textSize * (HAN_FACE_EM / FLUENT_FULL_HEIGHT_RATIO)).toDp() })
            .then(modifier),
    )
}

private val CAPSULE_HEIGHT = 32.dp

/** Noto Sans CJK 汉字字面高与字号之比。 */
private const val HAN_FACE_EM = 0.95f

/**
 * 图标中线比文字行框中线低多少字号。行框按西文字体排：汉字字面中线比行框中线低约 `0.04`，
 * 西文大写中线反而略高；取两者之间，中英文胶囊里图标与文字中线的偏差都不过半点。
 */
private const val GLYPH_DROP_EM = 0.015f

/** Fluent `24` 网格里满高字形占 `20`，上下各留 `2`。 */
private const val FLUENT_FULL_HEIGHT_RATIO = 20f / 24f
