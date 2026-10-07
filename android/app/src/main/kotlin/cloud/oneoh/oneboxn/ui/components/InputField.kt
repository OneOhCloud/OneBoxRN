package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.AppColors
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.stateTransitionSpec
import cloud.oneoh.oneboxn.ui.SecondaryTextSurface
import com.microsoft.fluent.mobile.icons.R as FluentR

// 统一输入组件（Android 唯一实现）：**无描边填充容器 + `BasicTextField`**，页面禁止另起输入样式。
//
// 形态有三种（编辑 / 度量 / 搜索），容器色、圆角、内衬、最小高同源；差别只在容器里放什么、容器外还有没有 supporting 行。
// 聚焦永远有两个可见信号（容器色 + 标签字重；没有标签的形态，第二个信号落在放大镜 / 单位上），
// 错误永远有图标 + supporting text；状态切换不改变容器尺寸；supporting 行恒占位避免布局跳动。
//
// 不用 M3 `TextField`：它的浮动标签落在容器内部上方，最小高 `40` 放不下「标签 + 输入行」。
// 标签仍然可见，且经 `contentDescription` 与输入框绑定。
@Composable
fun InputField(
    caption: InputCaption,
    value: String,
    onValueChange: (String) -> Unit,
    // 脚下那一层，由调用点声明、无默认值：默认值会让新页面静默拿到错底。
    ground: InputGround,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    supporting: String? = null,
    error: String? = null,
    errorIcon: Painter? = null,
    enabled: Boolean = true,
    multiline: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    initialCursor: InitialCursor = InitialCursor.Start,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    // 调用方给了自己的焦点请求者，就能在输入框出现时直接聚焦（由一个明确动作唤出的输入框不该再要人点第二下）。
    focusRequester: FocusRequester = remember { FocusRequester() },
) {
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val hasError = error != null
    // 「错误优先于聚焦」这一句在这里，**不在 `containerColor` 里**：优先级链是
    // **禁用 > 错误 > 聚焦 > 有值 > 默认**，判断放在调用点，色表只负责把状态翻成颜色。
    val visualState = when {
        hasError -> InputFieldVisualState.Error
        focused -> InputFieldVisualState.Focused
        else -> InputFieldVisualState.Default
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
            modifier = Modifier
                .inputContainer(animatedContainerColor(ground, visualState))
                // **整个容器可点即聚焦**：`BasicTextField` 不带这一条，不补的话可点面只剩那一行文字
                // （约 `18dp` 高），而容器画出来有 `54`。
                // `indication = null`：本件的按压反馈由容器色承担，不另加涟漪。
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    enabled = enabled,
                ) { focusRequester.requestFocus() }
                // 本件的三个态各走什么通道：
                // ```
                // 聚焦   **两个可见信号**：容器色转 `accentContainer` + 标签加字重。不走透明度。
                // 错误   容器转错误容器色 + supporting 行换错误前景 + 警示图标。不走透明度。
                // 禁用   **换一对更暗的前景色**（标签与输入文字同降到 `textSecondary`），容器保持 `fill`：
                //        整层压透明度会让对比度随系数一起趋近 1；`textSecondary` 压 `fill` 4.75 / 6.41，
                //        过文字门槛 4.5，且与启用态 `textPrimary` 可分。
                // 忙碌   **本件没有这一态**（输入框不承载异步）。
                // ```
                ,
        ) {
            // 聚焦的第二个可见信号（第一个是容器色）落在标签或单位的字重上；**标签不用 `accent`**
            // —— `accent` 压 `accentContainer` 只有 `3.27:1`。
            val strong = if (focused && !hasError) FontWeight.SemiBold else FontWeight.Normal
            if (caption is InputCaption.Label) {
                Text(
                    text = caption.text,
                    style = Theme.Type.subtitle,
                    fontWeight = strong,
                    color = when {
                        !enabled -> Theme.colors.textSecondary
                        hasError -> Theme.tones.error.fg
                        else -> Theme.colors.textPrimary
                    },
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
            ) {
                FieldText(
                    value = value,
                    onValueChange = onValueChange,
                    placeholder = placeholder,
                    enabled = enabled,
                    singleLine = !multiline,
                    minLines = if (multiline) 4 else 1,
                    maxLines = if (multiline) 8 else 1,
                    keyboardOptions = keyboardOptions,
                    initialCursor = initialCursor,
                    keyboardActions = keyboardActions,
                    interactionSource = interactionSource,
                    cursor = if (hasError) Theme.tones.error.fg else Theme.colors.accent,
                    placeholderSurface = secondarySurface(visualState),
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focusRequester)
                        // 标签可见，但读屏不会自动把它与输入框关联起来 ⇒ 显式绑上去。
                        // **必须 `mergeDescendants = true`**：不带它时无障碍树里没有任何节点带这个标签；
                        // 带上之后标签落在合并出来的那个 `View` 节点上，`EditText` 节点自己的
                        // `content-desc` 仍是空串。
                        .semantics(mergeDescendants = true) {
                            contentDescription = caption.spokenName
                            if (error != null) error(error)
                        },
                )
                if (caption is InputCaption.Measure) {
                    Text(
                        text = caption.unit,
                        style = Theme.Type.status,
                        fontWeight = strong,
                        // 字色恒为次要色、随容器升档（四处同源）。判据取的是**容器现在是不是 accentContainer**，
                        // 不是「聚不聚焦」：错误态的底是 `errorContainer`（`textSecondary` 压它 `4.76` 达标），
                        // 未聚焦是 `fill`（`4.75` 达标）—— 拿聚焦当判据会在错误态下多升一档。
                        color = Theme.secondaryText(on = secondarySurface(visualState), colors = Theme.colors),
                    )
                }
            }
        }
        // supporting 行恒占位：状态切换不得改变外框尺寸或引起布局跳动。
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (error != null) {
                if (errorIcon != null) {
                    Icon(
                        painter = errorIcon,
                        contentDescription = null,
                        tint = Theme.tones.error.fg,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(Theme.Spacing.xs))
                }
                Text(text = error, style = Theme.Type.subtitle, color = Theme.tones.error.fg)
            } else {
                Text(
                    text = supporting.orEmpty(),
                    style = Theme.Type.subtitle,
                    color = Theme.colors.textSecondary,
                )
            }
        }
    }
}

/** 编辑形态的框头：输入框靠什么说出「我是什么」。 */
sealed interface InputCaption {
    /** 读屏念的名字。 */
    val spokenName: String

    /** 标签在输入行之上。 */
    data class Label(val text: String) : InputCaption {
        override val spokenName get() = text
    }

    /**
     * 度量：数值在左、单位作尾随后缀在右，无可见标签——外层（弹层标题）已经说出它是什么，
     * 框上再标一遍名字是重复。[name] 只给读屏；单位担标签的角色，聚焦的字重信号落在它身上。
     */
    data class Measure(val name: String, val unit: String) : InputCaption {
        override val spokenName get() = name
    }
}

/**
 * 搜索形态：前置放大镜 + 有内容时的清除键，无标签、无 supporting。
 *
 * 与编辑形态共用 [containerColor]、圆角、内衬与最小高：各写各的颜色表会让聚焦前后一个像素不变，
 * 或让输入框与它所在的面同色。
 *
 * **放大镜在这里担标签的角色**：「聚焦永远有两个可见信号」是组件级不变式，
 * 而本形态没有标签 ⇒ 第二个信号落在它身上（前景转 `textPrimary`）。**不是装饰。**
 *
 * 清除走 `onValueChange("")`：过滤随输入生效，清空就是把输入改成空串，不另立一条回调。
 */
@Composable
fun SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    Box(
        contentAlignment = Alignment.CenterStart,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = FIELD_MIN_HEIGHT)
            .background(
                // 搜索形态没有错误态（无标签、无 supporting 行）⇒ 只在两档之间。
                // 搜索框恒坐在页面底上。
                animatedContainerColor(
                    InputGround.Page,
                    if (focused) InputFieldVisualState.Focused else InputFieldVisualState.Default,
                ),
                RoundedCornerShape(Theme.Radius.control),
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm),
            modifier = Modifier.padding(horizontal = Theme.Spacing.md, vertical = FIELD_VERTICAL_INSET),
        ) {
            Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_search_24_regular),
                contentDescription = null,
                tint = if (focused) Theme.colors.textPrimary else Theme.colors.textSecondary,
                modifier = Modifier.size(20.dp),
            )
            FieldText(
                value = value,
                onValueChange = onValueChange,
                placeholder = placeholder,
                enabled = true,
                singleLine = true,
                minLines = 1,
                maxLines = 1,
                // 搜索键只收起键盘：过滤已随输入生效，没有「提交」这一步。
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                initialCursor = InitialCursor.Start,
                keyboardActions = KeyboardActions.Default,
                interactionSource = interactionSource,
                placeholderSurface = secondarySurface(
                    if (focused) InputFieldVisualState.Focused else InputFieldVisualState.Default,
                ),
                cursor = Theme.colors.accent,
                modifier = Modifier.weight(1f),
            )
            // 清除键的命中区**恒占位**，图标只在有内容时画 —— 见下面那个 Box 的注释。
            Spacer(Modifier.width(CLEAR_TOUCH_TARGET - Theme.Spacing.md))
        }
        // **命中区 `48` 叠在容器的内衬上，而不是加在容器高度上**：Android 的 `48dp` 最小触控区
        // 靠布局让位满足，控件涂色的高度仍取 `40`，不把控件画大到 `48`。
        // 故它不在上面那个 `Row` 里：放进去会让容器涂色高度从 `40` 顶到 `48 + 20`。
        //
        // **槽位恒占**（上面那个 `Spacer`）：清除键随内容出现/消失，若不预留，
        // 行宽会在输入第一个字时跳一下。
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = Theme.Spacing.md)
                // **命中区不参与父容器的高度测量**：报 `0` 高，画的时候居中放回去。
                // 不加它，容器涂色高会被这颗 `48` 顶到 `48`，而最小高是 `40`。
                //
                // **顺序要紧**：`layout` 必须在 `size` **之前**。Compose 的修饰符链里
                // 写在前面的是**外层**节点——写成 `.size().layout{}` 时 `size` 在外，父容器量到的仍是 `48`。
                // 命中测试跟的是**摆放位置**不是测量尺寸，故命中区仍然是整个 `48`。
                .layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints)
                    layout(placeable.width, 0) { placeable.place(0, -placeable.height / 2) }
                }
                .size(CLEAR_TOUCH_TARGET),
        ) {
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange("") }, modifier = Modifier.size(CLEAR_TOUCH_TARGET)) {
                    Icon(
                        painter = painterResource(FluentR.drawable.ic_fluent_dismiss_circle_24_filled),
                        contentDescription = stringResource(R.string.logs_search_clear),
                        tint = Theme.colors.textSecondary,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

/**
 * 输入框出现时光标落在哪。**开头**是平台字符串形态输入框的原样行为，其余调用方都靠它；
 * **末尾**给「就地修改一个现成值」的输入框（例如改名），接着原值往后打字，与 Apple 的 `TextField` 一致。
 */
enum class InitialCursor { Start, End }

internal fun InitialCursor.selectionIn(text: String): TextRange = when (this) {
    InitialCursor.Start -> TextRange.Zero
    InitialCursor.End -> TextRange(text.length)
}

/**
 * 两种形态共用的输入本体：占位文案由 [BasicTextField] 的装饰位画，不另起一个控件。
 *
 * 走 `TextFieldValue` 形态而不是字符串形态：字符串形态把初始选区钉在开头，定不了 [InitialCursor.End]。
 * 下面持有选区与输入法组合区、只在文字真变了才回调的那几行，照的就是字符串形态自己的做法，
 * 于是 [InitialCursor.Start] 与换形态之前逐字同一行为。
 */
@Composable
private fun RowScope.FieldText(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String?,
    enabled: Boolean,
    singleLine: Boolean,
    minLines: Int,
    maxLines: Int,
    keyboardOptions: KeyboardOptions,
    initialCursor: InitialCursor,
    keyboardActions: KeyboardActions,
    interactionSource: MutableInteractionSource,
    cursor: Color,
    placeholderSurface: SecondaryTextSurface,
    modifier: Modifier = Modifier,
) {
    var fieldState by remember { mutableStateOf(TextFieldValue(value, initialCursor.selectionIn(value))) }
    // 文字以调用方为准（清除键、调用方重置都从这里进来）；选区越界由 TextFieldValue 自己钳回文字之内。
    val field = fieldState.copy(text = value)
    SideEffect {
        if (field.selection != fieldState.selection || field.composition != fieldState.composition) {
            fieldState = field
        }
    }
    // 两次重组之间输入法可能连着回调几次同一串文字：只在文字真变了才往外报。
    var lastText by remember(value) { mutableStateOf(value) }
    BasicTextField(
        value = field,
        onValueChange = { next ->
            fieldState = next
            val changed = lastText != next.text
            lastText = next.text
            if (changed) onValueChange(next.text)
        },
        modifier = modifier,
        enabled = enabled,
        // 禁用时输入文字与标签同降一档（见本件三态那段）。
        textStyle = Theme.Type.control.copy(
            color = if (enabled) Theme.colors.textPrimary else Theme.colors.textSecondary,
        ),
        cursorBrush = SolidColor(cursor),
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        interactionSource = interactionSource,
        decorationBox = { field ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty() && placeholder != null) {
                    Text(
                        text = placeholder,
                        style = Theme.Type.control,
                        // 占位符与输入文字同容器 ⇒ 同样随底升档（四处同源）。
                        // 这一处是本端独有的：Apple 用系统 `TextField` 自带的占位（系统色，
                        // 不经本仓令牌），而本端是自绘的 ⇒ 它在本端才是这个令牌的消费点。
                        color = Theme.secondaryText(on = placeholderSurface, colors = Theme.colors),
                    )
                }
                field()
            }
        },
    )
}

/**
 * 编辑形态的容器落点（搜索形态同值）：`Radius.control`、内衬 `12 × 10`、最小高 `40`，
 * **无描边、无 indicator、无下划线**。
 *
 * **`10` 不在间距档里**，故它在这里有自己的名字：容器内衬由**最小高与字号**定，
 * **不参与页面的间距节奏**（Apple 端同名同值，`InputFieldMetrics.verticalInset`）。
 */
private fun Modifier.inputContainer(color: Color): Modifier =
    this
        .fillMaxWidth()
        .heightIn(min = FIELD_MIN_HEIGHT)
        .background(color, RoundedCornerShape(Theme.Radius.control))
        .padding(horizontal = Theme.Spacing.md, vertical = FIELD_VERTICAL_INSET)

/**
 * 容器的视觉态。**三档互斥，不是两个布尔。**
 *
 * **为什么是枚举**：`(focused, hasError)` 两个布尔写得出**四种组合**，而合法的只有三种——
 * 「聚焦且有错」那一格要么无意义、要么有一个隐含的优先级，**而那个优先级只写在 `if` 的顺序里**。
 * 枚举把它抬到调用点，编译期可穷举。优先级链：**禁用 > 错误 > 聚焦 > 有值 > 默认**。
 *
 * **这条链只管外观取值，不管无障碍**：错误盖住聚焦的是**容器色**，**不是焦点本身**
 * —— 读屏仍要报「已聚焦 + 有错」两件（本件的 `semantics` 里 `error(...)` 与焦点各自独立）。
 */
private enum class InputFieldVisualState { Default, Focused, Error }

/**
 * 输入框坐在什么上面（Apple 同；与站标砖的托底同一张表）。
 * **入参是「面」，不是一个 `Boolean`**：调用点回答「我压在什么上面」，容器取什么色只在 [restContainer] 决定。
 */
enum class InputGround {
    /** 页面底色上（搜索、配置改名）。 */
    Page,

    /** `surface` 面上（弹层面板、卡片：导入 URL / 规则批量值 / 引擎参数）。 */
    Surface,
}

/**
 * 未聚焦的容器色：脚下那一层之上的一层。取同一层，聚焦之前输入框根本不存在；
 * 页面底上取 `fill`，是一块比带晕染的页底更深、发脏的灰——取 `surface`，与卡片、dock 同族。
 * `surface` 面上取 `fill`，与同一面上的次要按钮同族。纯函数形态，可直接单测。
 */
internal fun InputGround.restContainer(colors: AppColors): Color = when (this) {
    InputGround.Page -> colors.surface
    InputGround.Surface -> colors.fill
}

/**
 * 次级文字（标签后缀 / 占位符）该按哪种底取色。
 *
 * **判别式与 [containerColor] 同源**：问的是「这一档的容器色是不是 `accentContainer`」，
 * 不是「聚不聚焦」—— 错误态同样不聚焦不了，而它的底是 `errorContainer`。
 * 两个 `when` 写在一起，改容器色时不会漏掉这一个。
 */
private fun secondarySurface(state: InputFieldVisualState): SecondaryTextSurface = when (state) {
    InputFieldVisualState.Focused -> SecondaryTextSurface.AccentContainer
    InputFieldVisualState.Error, InputFieldVisualState.Default -> SecondaryTextSurface.Plain
}

/** 未聚焦态取 [InputGround.restContainer]。 */
@Composable
private fun containerColor(ground: InputGround, state: InputFieldVisualState): Color = when (state) {
    InputFieldVisualState.Error -> Theme.tones.error.container
    InputFieldVisualState.Focused -> Theme.colors.accentContainer
    InputFieldVisualState.Default -> ground.restContainer(Theme.colors)
}

/**
 * 容器色的**过渡**：状态切换 `150ms`，仅颜色；容器尺寸恒定。
 *
 * 走 `stateTransitionSpec()`（= `Motion.COLOR_MS` = `150`），它在**减少动态效果**时退化为 `snap`
 * ——只去掉过渡，颜色照常到位。
 *
 * **首次渲染不过渡**是 `animateColorAsState` 自带的：它以目标值起始，只在**之后**的变化上动
 * （那一刻还没有「上一个状态」，动起来只会是一次凭空淡入）。
 */
@Composable
private fun animatedContainerColor(ground: InputGround, state: InputFieldVisualState): Color {
    val color by animateColorAsState(
        targetValue = containerColor(ground, state),
        animationSpec = stateTransitionSpec(),
        label = "inputContainerColor",
    )
    return color
}

private val FIELD_MIN_HEIGHT = 40.dp

/** Android 的最小触控区。**它只撑命中区，不撑涂色高度**，见 [SearchField]。 */
private val CLEAR_TOUCH_TARGET = 48.dp

/** `10`：见 [inputContainer] 的注释——它不是间距档上的数。 */
private val FIELD_VERTICAL_INSET = 10.dp
