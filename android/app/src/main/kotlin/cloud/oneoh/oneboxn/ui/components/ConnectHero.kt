package cloud.oneoh.oneboxn.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.HeroSurface
import cloud.oneoh.oneboxn.ui.Motion
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.motionSpec
import com.microsoft.fluent.mobile.icons.R as FluentR

// 电源砖与光晕：整个产品唯一的主操作，也是全仓最重的一份材质。
//
// 那份材质是**静态光学**而不是运动：禁止光环、旋转 spinner、呼吸缩放、粒子与进度环。
// 它们都在暗示「系统正在努力」，而启动引擎通常一秒内就结束——持续运动会让快的操作显得慢，
// 也会让真正的失败态失去对比度。连接中的进行感由下方的文字与状态点承担。

/** 连接相位：五个相位各自决定砖面、光晕、状态点与文案。 */
enum class ConnectPhase { IDLE, CONNECTING, CONNECTED, SWITCHING, FAILED }

private val REFERENCE_ICON_SIZE = 44.dp
/**
 * 基准砖上的光晕直径（屏上目标曲线）：α < 1/255 落在 `r ≈ 163.8`
 * ⇒ **直径必须 ≥ `328`**，否则渐变还没归零就被元素几何截断。
 *
 * 不取参考实现的 `240`：那是喂给 `blur(44px)` 的源图边长，不是屏上的可见范围；本端不做那道后处理。
 */
private val REFERENCE_GLOW_DIAMETER = 328.dp

/**
 * 基准砖上光晕圆心相对**电源砖圆心**的下移量（不变量：圆心比砖心低 `58`）。
 *
 * 不写成「顶边偏移」：顶边偏移里藏着半径，直径一变圆心就跟着滑走；按圆心写，这一维不随直径漂。
 */
private val REFERENCE_GLOW_CENTER_DROP = 58.dp

/**
 * 电源砖随边长变化的尺寸账：各项原始量按基准砖 `160` 定，再按 [scale] 等比——
 * 砖边长一变，图标、光晕与圆角必须同比跟上，否则光晕相对砖缩小、圆角相对砖变方。
 * 内侧高光线宽不随边长变，与 iOS 同。
 */
@Immutable
data class HeroGeometry(val tileSide: Dp) {
    val scale: Float get() = tileSide / REFERENCE_TILE_SIDE
    val iconSize: Dp get() = REFERENCE_ICON_SIZE * scale
    val glowDiameter: Dp get() = REFERENCE_GLOW_DIAMETER * scale
    val glowCenterDrop: Dp get() = REFERENCE_GLOW_CENTER_DROP * scale
    val cornerRadius: Dp get() = Theme.Radius.hero * scale
    val idleGlowRadius: Dp get() = REFERENCE_IDLE_GLOW_RADIUS * scale

    companion object {
        /** 基准砖边长：上面各项的原始量都按它定。 */
        val REFERENCE_TILE_SIDE = 160.dp
    }
}

/**
 * 砖上那一枚符号。没有配置时同一块砖是导入入口：外形、分档、光晕规则都不变，只换符号与读屏标签。
 * 符号说的是「按下去会发生什么」，故随动作一起给。
 */
enum class HeroGlyph { Power, ImportConfig }

/**
 * 电源砖的动作：读屏标签说「按下去会发生什么」，`onClick` 为 `null` 即禁用——
 * **「没有可执行的动作」正是禁用的定义**，故不另立一个 `enabled` 开关。
 * 标签由调用方给而不是从相位推：断开中相位是「切换中」，而标签仍应是「断开」。
 */
@Immutable
data class HeroAction(
    val accessibilityLabel: String,
    val onClick: (() -> Unit)?,
    val glyph: HeroGlyph = HeroGlyph.Power,
)

private val INNER_EDGE_WIDTH = 1.5.dp

/**
 * 基准砖上那一圈同形柔光的模糊半径。Apple 那一端是 `radius 14`（标准差口径）；
 * 本端的模糊半径约是标准差的 `1.73` 倍，折成 `24`。
 */
private val REFERENCE_IDLE_GLOW_RADIUS = 24.dp

private const val PRESSED_SCALE = 0.975f
/**
 * 光晕峰值不透明度（`r = 0` 处），取自**屏上**目标曲线。
 *
 * 不取参考喂给模糊的源图峰值 `0.30`（它屏上的峰值约 `0.106`）：照抄源图会让光晕浓将近三倍。
 */
private const val GLOW_CORE_ALPHA = 0.1569f

/** 状态点脉冲的专用缓动：与主缓动不同，它要两头都慢。 */
private val PulseEasing = CubicBezierEasing(0.45f, 0f, 0.55f, 1f)

@Composable
fun ConnectHero(phase: ConnectPhase, geometry: HeroGeometry, action: HeroAction) {
    val accent = Theme.colors.accent
    val glowAlpha by animateFloatAsState(
        targetValue = when (phase) {
            ConnectPhase.CONNECTED -> 1f
            ConnectPhase.CONNECTING, ConnectPhase.SWITCHING -> 0.55f
            ConnectPhase.IDLE, ConnectPhase.FAILED -> 0f
        },
        animationSpec = motionSpec(Motion.GLOW_MS),
        label = "heroGlow",
    )

    Box(
        modifier = Modifier
            .size(geometry.tileSide)
            // 光晕画在电源砖之下且不接收点击：它是氛围光，不是控件的一部分。
            // 用 Brush.radialGradient 直接画，**不用 Modifier.blur**——后者在低端机上会
            // 拉一层离屏合成，而这里的柔边靠渐变自身的收尾就够。
            // 画在 `drawBehind` 里而不是作为子项：光晕比砖大，作为子项会撑大这个框、把砖挤离原位。
            .drawBehind { if (glowAlpha > 0f) drawGlow(accent, glowAlpha, geometry) },
        contentAlignment = Alignment.Center,
    ) {
        PowerTile(phase = phase, geometry = geometry, action = action)
    }
}

@Composable
private fun PowerTile(phase: ConnectPhase, geometry: HeroGeometry, action: HeroAction) {
    val optics = Theme.heroOptics
    val surface = animatedHeroSurface(if (phase == ConnectPhase.CONNECTED) optics.active else optics.idle)
    val shape = RoundedCornerShape(geometry.cornerRadius)
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) PRESSED_SCALE else 1f,
        // 按下比回弹更快：按下要跟手，回弹允许多用 20ms 把形变收干净。
        animationSpec = motionSpec(if (pressed) HERO_PRESS_DOWN_MS else Motion.HERO_PRESS_MS),
        label = "heroPress",
    )
    val iconTint by animateColorAsState(
        targetValue = when (action.glyph) {
            // 导入入口取强调色：没有配置时它是这一页唯一的主操作，灰色的加号读起来像是不可点。
            HeroGlyph.ImportConfig -> Theme.colors.accent
            HeroGlyph.Power -> when (phase) {
                ConnectPhase.CONNECTED -> Theme.colors.onAccent
                ConnectPhase.CONNECTING, ConnectPhase.SWITCHING -> Theme.colors.accent
                ConnectPhase.IDLE -> Theme.colors.textSecondary
                ConnectPhase.FAILED -> Theme.tones.error.fg
            }
        },
        animationSpec = motionSpec(Motion.HERO_FILL_MS),
        label = "heroIcon",
    )

    Box(
        modifier = Modifier
            .size(geometry.tileSide)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            // 外侧光晕（三层光学之三）：与砖同形、不偏移的一圈柔光。不向下偏移——那是投影，
            // 读起来是砖浮在页面上方，与平卡同页时层级自相矛盾。亮色下砖面压页面只有 1.028，
            // 轮廓靠的正是这一圈。已连接时它取透明，让给砖下那团蓝色光晕。
            .dropShadow(shape, Shadow(radius = geometry.idleGlowRadius, color = surface.glow))
            .clip(shape)
            .background(
                Brush.linearGradient(
                    colors = surface.gradient,
                    // 140° 线性渐变：正方形砖面上左上角 → 右下角即 135°，
                    // 差的那 5° 肉眼不可分，而写成两个无穷大就不必把砖宽硬编成像素。
                    start = Offset.Zero,
                    end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY),
                ),
            )
            .drawBehind { drawInnerEdges(surface, geometry.cornerRadius) }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = action.onClick != null,
                role = Role.Button,
                onClick = { action.onClick?.invoke() },
            )
            .semantics {
                contentDescription = action.accessibilityLabel
                selected = phase == ConnectPhase.CONNECTED
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(
                when (action.glyph) {
                    HeroGlyph.Power -> FluentR.drawable.ic_fluent_power_24_regular
                    HeroGlyph.ImportConfig -> FluentR.drawable.ic_fluent_add_24_regular
                },
            ),
            contentDescription = null,
            tint = iconTint,
            modifier = Modifier.size(geometry.iconSize),
        )
    }
}

/**
 * 砖面与外侧光晕的 `280ms` 过渡。
 *
 * 渐变与内侧高光都是多个色值，Compose 没有「动画一个 Brush」的通道，故逐色插值后再合成笔刷——
 * 不这么做的话最主要的那次状态切换会是瞬切，而时长表里恰恰给它留了最长的一档。
 */
@Composable
private fun animatedHeroSurface(target: HeroSurface): HeroSurface {
    val top by animateColorAsState(target.gradient[0], motionSpec(Motion.HERO_FILL_MS), label = "heroTop")
    val mid by animateColorAsState(target.gradient[1], motionSpec(Motion.HERO_FILL_MS), label = "heroMid")
    val bottom by animateColorAsState(target.gradient[2], motionSpec(Motion.HERO_FILL_MS), label = "heroBottom")
    val topHighlight by animateColorAsState(
        target.topHighlight,
        motionSpec(Motion.HERO_FILL_MS),
        label = "heroTopHighlight",
    )
    val leftHighlight by animateColorAsState(
        target.leftHighlight,
        motionSpec(Motion.HERO_FILL_MS),
        label = "heroLeftHighlight",
    )
    val bottomShade by animateColorAsState(
        target.bottomShade,
        motionSpec(Motion.HERO_FILL_MS),
        label = "heroBottomShade",
    )
    val glow by animateColorAsState(target.glow, motionSpec(Motion.HERO_FILL_MS), label = "heroGlowRing")
    return HeroSurface(
        gradient = listOf(top, mid, bottom),
        topHighlight = topHighlight,
        leftHighlight = leftHighlight,
        bottomShade = bottomShade,
        glow = glow,
    )
}

/**
 * 状态行：`8` 状态点 + `17/600` 文案——压在大砖下面，`13` 那一档撑不起「连没连上」这一层级。
 * 连接中与切换中脉冲，其余相位静止——运动越少，状态越可信。
 */
@Composable
fun ConnectStatusRow(phase: ConnectPhase, text: String, modifier: Modifier = Modifier) {
    val pulsing = phase == ConnectPhase.CONNECTING || phase == ConnectPhase.SWITCHING
    val dotColor by animateColorAsState(
        // **不用 `else -> accent`**：accent 读作「一切正常」——新增一个相位会静默取它。
        // 列全之后再加相位就编译不过（Kotlin 2.4 强制穷尽）。
        targetValue = when (phase) {
            ConnectPhase.IDLE -> Theme.colors.textSecondary
            ConnectPhase.FAILED -> Theme.tones.error.fg
            ConnectPhase.CONNECTING,
            ConnectPhase.CONNECTED,
            ConnectPhase.SWITCHING,
            -> Theme.colors.accent
        },
        animationSpec = motionSpec(Motion.COLOR_MS),
        label = "statusDot",
    )
    val dotAlpha = if (pulsing && !Theme.reduceMotion) rememberPulseAlpha() else 1f

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
    ) {
        Box(
            Modifier
                .size(STATUS_DOT_SIZE)
                // 连接中 / 切换中的呼吸脉冲。**相位本身由 `dotColor` 与文案承担**（IDLE 二档灰 / FAILED 错误前景 / 其余 accent），脉冲是同一相位内的动效；`reduceMotion` 下恒 `1f`。
                .graphicsLayer { alpha = dotAlpha }
                .background(dotColor, CircleShape),
        )
        Text(
            text = text,
            style = Theme.Type.heroStatus,
            color = if (phase == ConnectPhase.IDLE) {
                Theme.colors.textSecondary
            } else if (phase == ConnectPhase.FAILED) {
                Theme.tones.error.fg
            } else {
                Theme.colors.textPrimary
            },
        )
    }
}

@Composable
private fun rememberPulseAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "statusPulse")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = PULSE_MIN_ALPHA,
        animationSpec = infiniteRepeatable(
            animation = tween(Motion.PULSE_MS, easing = PulseEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "statusPulseAlpha",
    )
    return alpha
}

/**
 * 径向渐变的光晕：**停靠点是目标曲线上的采样值本身，不是插出来的**。
 *
 * 目标是**屏上**曲线（不是离屏那条，两者差约 5%），offset 按 `r / 164` 反算：
 *
 * ```
 * r=0    α 0.1569   offset 0
 * r=40   α 0.1299   offset 0.2439
 * r=80   α 0.0725   offset 0.4878   ← 砖边缘，五停靠点在这里逐位命中
 * r=120  α 0.0255   offset 0.7317
 * r=164  α < 1/255  offset 1
 * ```
 */
private fun DrawScope.drawGlow(accent: Color, alpha: Float, geometry: HeroGeometry) {
    val radius = geometry.glowDiameter.toPx() / 2f
    val center = Offset(
        x = size.width / 2f,
        y = size.height / 2f + geometry.glowCenterDrop.toPx(),
    )
    drawCircle(
        brush = Brush.radialGradient(
            colorStops = arrayOf(
                // 径向渐变的停靠点色，由入参整体缩放。光晕是氛围层，**未连接时完全不渲染**（不是压到很淡），故它不承担任何需要读出来的状态。
                0f to accent.copy(alpha = GLOW_CORE_ALPHA * alpha),
                // 透明度字面量：四个停靠点是同一条光学曲线上的四个采样，收进令牌就等于给每个停靠点各起一个名字；峰值那一个已具名为 `GLOW_CORE_ALPHA`。
                0.2439f to accent.copy(alpha = 0.1299f * alpha),
                // 透明度字面量：同一条曲线的下一个采样。
                0.4878f to accent.copy(alpha = 0.0725f * alpha),
                // 透明度字面量：同一条曲线的末段采样。
                0.7317f to accent.copy(alpha = 0.0255f * alpha),
                1f to Color.Transparent,
            ),
            center = center,
            radius = radius,
        ),
        radius = radius,
        center = center,
    )
}

/**
 * 内侧高光（三层光学之二）：顶边与左边各一道亮线（顶边更亮），底边一道极淡暗线。
 * 三道都是描边而非填充，故不会把砖面本身的渐变盖住。
 */
private fun DrawScope.drawInnerEdges(surface: HeroSurface, cornerRadius: Dp) {
    val stroke = INNER_EDGE_WIDTH.toPx()
    val corner = CornerRadius(cornerRadius.toPx())
    val inset = Offset(stroke / 2f, stroke / 2f)
    val inner = Size(size.width - stroke, size.height - stroke)
    drawRoundRect(
        brush = Brush.verticalGradient(
            0f to surface.topHighlight,
            0.5f to Color.Transparent,
            startY = 0f,
            endY = size.height,
        ),
        topLeft = inset,
        size = inner,
        cornerRadius = corner,
        style = Stroke(width = stroke),
    )
    drawRoundRect(
        brush = Brush.horizontalGradient(
            0f to surface.leftHighlight,
            0.5f to Color.Transparent,
            startX = 0f,
            endX = size.width,
        ),
        topLeft = inset,
        size = inner,
        cornerRadius = corner,
        style = Stroke(width = stroke),
    )
    drawRoundRect(
        brush = Brush.verticalGradient(
            0.5f to Color.Transparent,
            1f to surface.bottomShade,
            startY = 0f,
            endY = size.height,
        ),
        topLeft = inset,
        size = inner,
        cornerRadius = corner,
        style = Stroke(width = stroke),
    )
}

private const val HERO_PRESS_DOWN_MS = 120
private val STATUS_DOT_SIZE = 8.dp
private const val PULSE_MIN_ALPHA = 0.3f
