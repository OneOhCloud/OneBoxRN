package cloud.oneoh.oneboxn.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import cloud.oneoh.oneboxn.ui.MainEasing
import cloud.oneoh.oneboxn.ui.Motion
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.shadowPopup
import cloud.oneoh.oneboxn.ui.tabular
import androidx.compose.ui.text.style.TextOverflow
import cloud.oneoh.oneboxn.ui.SecondaryTextSurface
import com.microsoft.fluent.mobile.icons.R as FluentR

// 下拉面板与选项行：面板由顶栏菜单（[ToolbarMenu]）用，选项行另由选择弹层（[SelectionSheet]）共用。
//
// **用 Popup + 自绘面板，不用 `DropdownMenu`**——后者自带 Material 的直角背板与固定海拔，
// 两样都要改，改完已经不是原生组件了。

/** 触发器与面板之间的间隔。 */
internal val PANEL_GAP = 8.dp

/** 翻转判据里的安全余量：可用空间不足 `最大高 + 这一档` 时向上展开。 */
internal val FLIP_MARGIN = 16.dp

/** 选项逐条错峰的条数上限——再多就成了「列表在自己滚进来」。 */
private const val STAGGER_MAX_ITEMS = 8

private const val STAGGER_STEP_MS = 12
private const val OPTION_FADE_MS = 180
private const val PANEL_ENTER_SCALE = 0.96f
private val PANEL_ENTER_SHIFT = 6.dp

/** 选项行之间的间隔：下拉面板与选择弹层是同一种行，行距也只有一个来源。 */
internal val OPTION_ROW_GAP = 2.dp

/** 选项行是不是当前选中。用枚举而不是布尔：调用点写 `MenuOptionState.Chosen` 读得出是哪一态，写 `true` 读不出。 */
internal enum class MenuOptionState { Plain, Chosen }

/**
 * 选项行怎么出现。
 *
 * 惰性列表里的行随滚动反复进出组合，每次进来都重播淡入，滚动时整列就在闪 ⇒ 那里要 `Immediate`；
 * 错峰只属于「整块面板一次性展开」这一种场合。
 */
internal sealed interface OptionEntrance {
    /** 下拉面板：按行序错峰淡入。 */
    data class Staggered(val index: Int) : OptionEntrance

    /** 选择弹层的惰性列表：直接出现。 */
    data object Immediate : OptionEntrance
}

/**
 * 面板宽由内容撑开，这是它的下限：容得下最长的选项标签。
 * 不跟锚点宽——顶栏锚点是一段文字，跟着它宽会把面板挤成一条。
 */
private val MENU_PANEL_MIN_WIDTH = 200.dp

/** 面板宽的上限：顶栏菜单是「在当前值旁边换一个」，不该盖住半屏内容。 */
private val MENU_PANEL_MAX_WIDTH = 280.dp

@Composable
internal fun <T> MenuPanel(
    options: List<T>,
    selected: T?,
    maxPanelHeight: Dp,
    openUpward: Boolean,
    optionTitle: @Composable (T) -> String,
    onSelect: (T) -> Unit,
) {
    val reduceMotion = Theme.reduceMotion
    val entrance = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduceMotion) entrance.animateTo(1f, tween(Motion.MENU_MS, easing = MainEasing))
    }
    Column(
        verticalArrangement = Arrangement.spacedBy(OPTION_ROW_GAP),
        modifier = Modifier
            // **上限不能省**：选项行是 `fillMaxWidth()`，而 `Popup` 给的最大宽是整个窗口
            // ⇒ 只给下限时面板会**横跨整屏**。
            .widthIn(min = MENU_PANEL_MIN_WIDTH, max = MENU_PANEL_MAX_WIDTH)
            .graphicsLayer {
                // 下拉面板的入场动效（alpha 与 scale 同一条 `entrance`）；开合这件事由面板在不在承担，不由它停在某个半透明值上。
                alpha = entrance.value
                val scale = PANEL_ENTER_SCALE + (1f - PANEL_ENTER_SCALE) * entrance.value
                scaleX = scale
                scaleY = scale
                // 变换原点随翻转方向：向上展开时面板贴着触发器的下沿长出来，
                // 原点留在顶上会让它看起来从别处飞来。
                transformOrigin = TransformOrigin(0.5f, if (openUpward) 1f else 0f)
                translationY = (1f - entrance.value) * PANEL_ENTER_SHIFT.toPx() *
                    if (openUpward) 1f else -1f
            }
            // 同心圆角：面板 `panel 18` − 内衬 `6` = 选项行 `control 12`。
            // 家族里只有这一组等式成立，故凡内部嵌带底色圆角块的容器一律取 `panel`。
            .shadowPopup(RoundedCornerShape(Theme.Radius.panel))
            .clip(RoundedCornerShape(Theme.Radius.panel))
            // 不透明 `surface`：这是「半透明 + 模糊」材质取不到时的回落。
            // 半透明不能单独上：没有模糊的半透明会让底下的正文透出来，比不透明更差。
            // 而 Android 的背板模糊不是一个修饰符：它要 `Window.setBackgroundBlurRadius`
            // （**API 31+**，本仓 `minSdk = 28`）**且**运行时 `WindowManager.isCrossWindowBlurEnabled()`
            // 为真——后者在低端机与用户关掉动效时为假 ⇒ 31+ 上也仍然需要这条回落。
            .background(Theme.colors.surface)
            .heightIn(max = maxPanelHeight)
            .verticalScroll(rememberScrollState())
            .padding(Theme.Spacing.panelInset),
    ) {
        options.forEachIndexed { index, option ->
            MenuOptionRow(
                title = optionTitle(option),
                subtitle = null,
                state = if (option == selected) MenuOptionState.Chosen else MenuOptionState.Plain,
                entrance = OptionEntrance.Staggered(index),
                trailing = {},
                onClick = { onSelect(option) },
            )
        }
    }
}

@Composable
internal fun MenuOptionRow(
    title: String,
    subtitle: String?,
    state: MenuOptionState,
    entrance: OptionEntrance,
    /**
     * 行尾槽。**参数是「这一行此刻坐在什么底上」**：选中行铺 `accentContainer`，
     * 而语义色压它全部不达标（`error.fg` `4.27` · `warning.fg` `4.40` · `success.fg` `4.25` ·
     * `textSecondary` `4.30`，文字门槛 `4.5`）⇒ **槽里的文字要不要升档，只有行自己知道**。
     * 不传这一位，调用点就只能拿「选中的是不是我」自己再算一遍 —— 那是同一件事的第二个来源。
     */
    trailing: @Composable (SecondaryTextSurface) -> Unit,
    onClick: () -> Unit,
) {
    val isSelected = state == MenuOptionState.Chosen
    val haptics = LocalHapticFeedback.current
    val reduceMotion = Theme.reduceMotion
    val stagger = (entrance as? OptionEntrance.Staggered)?.takeUnless { reduceMotion }
    val appearance = remember { Animatable(if (stagger == null) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (stagger != null) {
            appearance.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = OPTION_FADE_MS,
                    delayMillis = stagger.index.coerceAtMost(STAGGER_MAX_ITEMS - 1) * STAGGER_STEP_MS,
                    easing = MainEasing,
                ),
            )
        }
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
        modifier = Modifier
            .fillMaxWidth()
            // 选项行逐行入场的错峰动效；选中与否由 `accentContainer` 底与对勾承担。
            .graphicsLayer { alpha = appearance.value }
            .heightIn(min = 48.dp)
            .background(
                color = if (isSelected) {
                    Theme.colors.accentContainer
                } else {
                    Color.Transparent
                },
                shape = RoundedCornerShape(Theme.Radius.control),
            )
            .clip(RoundedCornerShape(Theme.Radius.control))
            .clickable {
                haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                onClick()
            }
            .semantics { selected = isSelected }
            .padding(horizontal = Theme.Spacing.md, vertical = Theme.Spacing.sm),
    ) {
        // 本行此刻的底：选中即 `accentContainer`。**取一次用两处**（副标题 / 行尾槽）——
        // 各处自己拿 `isSelected` 再算一遍时，只要有一处漏改，屏上就是「半行升档半行没升」，而它不会红。
        val rowSurface = if (isSelected) SecondaryTextSurface.AccentContainer else SecondaryTextSurface.Plain
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = title,
                // **`14/400`，不是 `control` 自带的 `14/500`**：`14/500` 是触发器的角色，
                // 选项行主文本同节点名（`14/400`，单行截断）。五个消费方共用这一个选项行；
                // 哪处要别的字重，是给组件加参数，不是改这里。
                style = Theme.Type.control.copy(fontWeight = FontWeight.Normal),
                // 选中行的文字仍用 textPrimary：accent 压 accentContainer 只有 3.27:1。
                color = Theme.colors.textPrimary,
                // 单行 + **尾部省略号**：`maxLines = 1` 单独不够，Compose 的默认收尾是 `Clip`（直接裁掉、没有省略号）。
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    // 副标题（如到期日、延迟读数）`11`、**等宽数字**：延迟读数每拍变化，非等宽数字会让整列左右跳。
                    style = Theme.Type.meta.tabular(),
                    // 选中行的底是 `accentContainer`，而 `textSecondary` 压它亮态只有 `4.30`
                    // ⇒ 随底升档（`Theme.secondaryText`，四处同源）。首页配置选择器逐行都带副标题。
                    color = Theme.secondaryText(on = rowSurface, colors = Theme.colors),
                    maxLines = 1,
                )
            }
        }
        trailing(rowSurface)
        // **勾选位恒占位**：未选中时留一个等大的空位，不是不渲染——同一行的文本截断点不得随选择状态改变：
        // 不占位时未选中行的可用宽多出 `16` + 行内间隔，选中项一换，两行的截断点就会跳。
        // 用 `Spacer` 而不是 `alpha = 0`：要的是**占位**，整层透明度是另一条通道。
        if (isSelected) {
            Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_checkmark_24_regular),
                contentDescription = null,
                tint = Theme.colors.accent,
                modifier = Modifier.size(16.dp),
            )
        } else {
            Spacer(Modifier.size(16.dp))
        }
    }
}

/**
 * 自动翻转：下方可用空间不足 `最大高 + 16` 时向上展开。
 *
 * 判据用**最大高**而不是测得的内容高：内容矮于最大高时向下本来也放得下，但选项是异步到的
 * （节点延迟、配置刷新都会改行数），按测得的高度定方向会在面板已经展开后又需要翻一次。
 *
 * 面板贴锚点**右缘**：顶栏 action 靠窗口右缘，**左对齐会让面板溢出窗口**。
 */
internal class FlipPositionProvider(
    private val gapPx: Int,
    private val flipThresholdPx: Int,
    private val onFlipResolved: (Boolean) -> Unit,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val spaceBelow = windowSize.height - anchorBounds.bottom
        val upward = spaceBelow < flipThresholdPx
        onFlipResolved(upward)
        val y = if (upward) {
            anchorBounds.top - gapPx - popupContentSize.height
        } else {
            anchorBounds.bottom + gapPx
        }
        val x = anchorBounds.right - popupContentSize.width
        // 两侧都不许出窗：锚点比面板窄时左边可能为负。
        val maxX = (windowSize.width - popupContentSize.width).coerceAtLeast(0)
        return IntOffset(x = x.coerceIn(0, maxX), y = y.coerceAtLeast(0))
    }
}

/**
 * 顶栏 action 的下拉菜单（配置查看、日志来源、日志级别三屏）：当前值文字按钮 + 自绘弹出面板
 * （不用 `DropdownMenu`）。
 *
 * 三屏共用这一件，不是各自抄一份 `Popup`——面板几何、翻转余量、错峰入场、选中语义只有一个来源；
 * 三处各写一遍，那几维会各自漂。
 */
@Composable
internal fun <T> ToolbarMenu(
    expanded: Boolean,
    options: List<T>,
    selected: T?,
    maxPanelHeight: Dp,
    optionTitle: @Composable (T) -> String,
    onDismiss: () -> Unit,
    onSelect: (T) -> Unit,
) {
    if (!expanded) return
    var openUpward by remember { mutableStateOf(false) }
    val density = LocalDensity.current
    val positionProvider = remember(maxPanelHeight, density) {
        FlipPositionProvider(
            gapPx = with(density) { PANEL_GAP.roundToPx() },
            flipThresholdPx = with(density) { (maxPanelHeight + FLIP_MARGIN).roundToPx() },
            onFlipResolved = { upward -> openUpward = upward },
        )
    }
    Popup(
        popupPositionProvider = positionProvider,
        onDismissRequest = onDismiss,
        properties = PopupProperties(focusable = true),
    ) {
        MenuPanel(
            options = options,
            selected = selected,
            maxPanelHeight = maxPanelHeight,
            openUpward = openUpward,
            optionTitle = optionTitle,
            onSelect = { value ->
                onDismiss()
                onSelect(value)
            },
        )
    }
}

/** 顶栏菜单的最大高：三屏的选项都不多（2 / 2 / 5 项），够高到不滚、又不至于盖住半屏。 */
internal val TOOLBAR_MENU_MAX_HEIGHT = 320.dp
