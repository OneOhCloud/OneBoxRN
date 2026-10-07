package cloud.oneoh.oneboxn.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Motion
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.cardSurface
import cloud.oneoh.oneboxn.ui.motionSpec
import com.microsoft.fluent.mobile.icons.R as FluentR

// 分组卡与卡内行。
// 设置页、开发者页、高级设置页、内核信息页与配置页的两张卡共用同一份——多处同形即须同源。

/**
 * 分组卡：`surface` + `Radius.card`，平的（外观同 `cardSurface`），**卡内行与行之间不画任何分隔线**。
 *
 * 行靠三样东西分开：每行至少 `52` 的高度、左侧 `28` 宽的图标列形成的竖向节奏、按下时整行填充。
 *
 * `label` 为 null 即无区段小标题——设置页四张卡都不带标题（加了会让本页出现四个 `11` 大写块，
 * 与首页 / 配置页的节奏不一致）。
 */
@Composable
fun SettingsGroup(label: String?, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(SECTION_LABEL_GAP)) {
        if (label != null) {
            SectionHeader(title = label)
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .cardSurface()
                .padding(vertical = Theme.Spacing.xs),
        ) {
            content()
        }
    }
}

/**
 * 行图标的**语义族**。
 *
 * 着色的判别式是「这一行属于哪一族」，不是「这是哪个图标」——同一个图标可以一处带色一处不带。
 * 故这里传的是**族**，不是一个 `Color` 参数：传颜色会让下一个人按图标挑色。
 */
enum class SettingsIconFamily {
    /** 网络 / 连接（`iconConnectivity`）：路由模式 · 区域。 */
    Networking,

    /** 信息 / 导航（`accent`）：路由规则 · 诊断组六行 · 高级设置 · 关于 · 更新记录。 */
    Informational,

    /**
     * **不上族色**（`textSecondary`）。消费方是外链行（`LinkRow` 写死，官网 / 隐私两行）：
     * 它不是一个功能入口。
     *
     * Compose 的 `Icon` 必须给一个 tint（`Color.Unspecified` 会让单色矢量按它自己声明的颜色画），
     * 故「不上色」在本端落成 `textSecondary`：同一行尾部的 `arrow.up.right` 已经是这一档；
     * 取 `textPrimary` 会让图标与主标题同重，那不是「不上色」，是换了一种强调。
     */
    Neutral,
}

@Composable
private fun SettingsIconFamily.tint(): Color = when (this) {
    SettingsIconFamily.Networking -> Theme.colors.iconConnectivity
    SettingsIconFamily.Informational -> Theme.colors.accent
    SettingsIconFamily.Neutral -> Theme.colors.textSecondary
}

/**
 * 一行的可交互性。三者互斥，**合法组合只有三种**：「不可点」有禁用与纯展示两种含义，呈现也不同；
 * 收成一个类型，「哪种不可点」必须在调用点说清楚，说不清楚就编译不过。
 */
sealed interface RowInteraction {
    /** 纯展示行（隧道状态 / DNS / 操作系统这类）：不可点，但**不弱化前景**。 */
    data object Display : RowInteraction

    data class Clickable(val onClick: () -> Unit) : RowInteraction

    /** 禁用：**换一对更暗的前景色**（图标与文字同降，不整层压透明度），
     *  且不可点、不入焦点序（只换色会留下一个点得动的灰行）。 */
    data object Disabled : RowInteraction
}

/**
 * 卡内行的统一骨架：`28` 图标列 → 主标题 `15` + 副标题 `12` → 尾部。
 *
 * `icon` **可空但无默认值**：可空是因为「这一行有意不留图标列」是一个真实状态（关于弹层内部那几行）；
 * **无默认值**是因为有默认值时「忘了给」与「有意不给」在调用点长得一模一样。
 * 留 null 时整个图标列不占位，不摆一个空方框。
 *
 * `technicalCaption` 是**技术值**那一档副文本，恒等宽、**恒单行截尾**。
 * 全仓只有一处用它——关于弹层的 User-Agent 行。
 *
 * **等宽**是因为它要能逐字比对：UA 决定服务端下发引擎 JSON 还是 Clash YAML；
 * 比例字体会让 `0`/`O`、`1`/`l` 在这种串里读混。
 *
 * **截尾的正当性挂在复制按钮上**：完整值由行尾那颗复制键带走（`AboutSheet.UserAgentRow`
 * 复制的是 `vm.userAgent` 本身，不是屏上这个截过的显示串）。**没有那颗键就不许截尾**——
 * 那等于把可读性删掉却不给回取回通道。改这一档前先确认按钮还在。
 *
 * 说明句（开关行的副文本）不走这里——它们在 `ToggleRow` 里自持。
 */
@Composable
fun SettingsRow(
    label: String,
    interaction: RowInteraction = RowInteraction.Display,
    modifier: Modifier = Modifier,
    icon: Int?,
    iconFamily: SettingsIconFamily = SettingsIconFamily.Informational,
    technicalCaption: String? = null,
    // 标题行数上限。缺省单行截尾；名字比值要紧的行（引擎参数）给 2：尾部（值）本就先量、贴合内容，
    // 标题拿剩下的宽度，先折行、两行仍放不下才截尾。
    titleMaxLines: Int = 1,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val onClick = (interaction as? RowInteraction.Clickable)?.onClick
    val enabled = interaction != RowInteraction.Disabled
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val hovered by interactionSource.collectIsHoveredAsState()
    // 悬停 / 按下**整行填充**：这是行与行之间的第三条分界手段，与 52 的行高、28 的图标列并列——不画分隔线。
    val rowFill by animateColorAsState(
        targetValue = when {
            !enabled || onClick == null -> Color.Transparent
            pressed -> Theme.colors.rowActive
            hovered -> Theme.colors.rowHover
            else -> Color.Transparent
        },
        animationSpec = motionSpec(Motion.ROW_MS),
        label = "settingsRowFill",
    )
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = modifier
            .fillMaxWidth()
            .background(rowFill)
            .then(
                if (onClick != null && enabled) {
                    Modifier.clickable(
                        interactionSource = interactionSource,
                        indication = null,
                        role = Role.Button,
                        onClick = onClick,
                    )
                } else if (interaction == RowInteraction.Disabled) {
                    // **禁用行必须仍然报成「一个被禁用的按钮」**，不能只是不挂 `clickable`：
                    // 只去掉可点性时，读屏把它念成一行普通文字——而禁用行要传达的恰恰是
                    // 「这里有个东西，现在还用不了」。颜色对给眼睛，这一句给读屏
                    // （`MenuPanel` 的禁用选项同理：自绘控件拿不到原生控件白送的这一位）。
                    // 纯展示行不走这里：它本来就不承诺点了会发生什么，报成禁用按钮反而是在撒谎。
                    Modifier.semantics {
                        role = Role.Button
                        disabled()
                    }
                } else {
                    Modifier
                },
            )
            .preferenceRowPadding(),
    ) {
        SettingsIconColumn(icon = icon, family = iconFamily, interaction = interaction)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = Theme.Type.rowTitle,
                // **禁用态换一对更暗的前景色，不整层压透明度**：`(a·L₁+0.05)/(a·L₂+0.05)` 随 a 下降
                // 必然趋近 1，要的是另一对颜色，不是另一个系数。`textSecondary` 压 surface 5.46 / 8.54、
                // 压 fill 4.75 / 6.41，全过 4.5；启用（`textPrimary`）、禁用、纯展示（不弱化）三态可分。
                // 文字只有两档，故带副标题的禁用行降不动第二行。
                color = if (enabled) Theme.colors.textPrimary else Theme.colors.textSecondary,
                maxLines = titleMaxLines,
                overflow = TextOverflow.Ellipsis,
            )
            if (technicalCaption != null) {
                Text(
                    text = technicalCaption,
                    style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                    color = Theme.colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing()
    }
}

/**
 * 卡内行的**前导图标列**：字形与行标题同一字阶——同高、随系统字号一起缩放；列宽按同一比例放大，
 * 字形变大而列宽不动时，大字号下字形会越出列、压到标题上。
 *
 * **提出来是因为它有第二个消费方**：开关行（`ToggleRow`）撑不住共用骨架
 * （共用行的副文本槽是**等宽技术值**，而开关要的是散文说明），于是它自绘一份行骨架。
 * 「自绘一份行」不该顺带自绘一份图标列——两份各自漂，屏上看不出来。
 *
 * 两端同名（Apple `SettingsIconColumn`）。
 *
 * [icon] 为 null ⇒ **整列不占位**（不摆一个空方框），服务「有意不留图标列」的行（关于弹层内部的事实行）。
 */
@Composable
fun SettingsIconColumn(
    icon: Int?,
    family: SettingsIconFamily = SettingsIconFamily.Informational,
    interaction: RowInteraction = RowInteraction.Display,
) {
    if (icon == null) return
    val titleSize = with(LocalDensity.current) { Theme.Type.rowTitle.fontSize.toDp() }
    val typeScale = titleSize / ROW_TITLE_REFERENCE
    Box(Modifier.width(Theme.RowMetrics.iconColumnWidth * typeScale), contentAlignment = Alignment.CenterStart) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            // 禁用时图标与标题**同降一档**：降的是**族色 → 二档灰**，不是压透明度（理由见 `SettingsRow` 那段读数）。
            tint = if (interaction == RowInteraction.Disabled) Theme.colors.textSecondary else family.tint(),
            // Material 字形在 `24` 的格里占 `20`：框取字号的 `24/20` 倍，屏上字形才与标题的字等高。
            modifier = Modifier.size(titleSize * GLYPH_BOX_PER_TYPE_SIZE),
        )
    }
}

/**
 * 导航行右侧那个值的两种角色。**用类型而不是第二个可选参数**：两个互斥的 `String?`
 * 会让「两个都传」成为一个可表达却没有含义的状态。
 *
 * **两种角色的字号不同，而这不是矛盾**：
 * - `Preference` 落在行骨架的当前值槽位上（`13`）；
 * - `Technical` 是**等宽技术值**，字阶取行骨架**第二行**（副标题 `12`，即 `Theme.Type.subtitle`）。
 *   等宽是这一档唯一的自有属性；同屏 UA 那一行（`technicalCaption`）也是 `subtitle` 等宽 ⇒ 四个技术值同源。
 */
sealed interface NavValue {
    val text: String

    /** 偏好值：当前值 `13` textSecondary。 */
    data class Preference(override val text: String) : NavValue

    /** 技术值（如版本串）：副标题档等宽 textSecondary。逐字比对用，故等宽。 */
    data class Technical(override val text: String) : NavValue
}

/** 导航行：右侧 chevron 表示推入（与外链行的 arrow.up.right、值行的上下箭头三分语义）。 */
@Composable
fun NavRow(
    label: String,
    interaction: RowInteraction,
    icon: Int?,
    value: NavValue? = null,
    iconFamily: SettingsIconFamily = SettingsIconFamily.Informational,
    titleMaxLines: Int = 1,
) {
    SettingsRow(
        label = label,
        interaction = interaction,
        icon = icon,
        iconFamily = iconFamily,
        titleMaxLines = titleMaxLines,
    ) {
        if (value != null) {
            Text(
                text = value.text,
                style = when (value) {
                    is NavValue.Preference -> Theme.Type.status
                    is NavValue.Technical -> Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace)
                },
                color = Theme.colors.textSecondary,
            )
            Spacer(Modifier.width(6.dp))
        }
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_chevron_right_24_regular),
            contentDescription = null,
            tint = Theme.colors.textSecondary,
            modifier = Modifier.size(Theme.RowMetrics.trailingIconSize),
        )
    }
}

/**
 * 外链行：尾部 arrow.up.right，语义是「离开本应用」而不是「推入下一层」。
 *
 * **族写死在这里，不开成参数**：不上色是「外链行」这个行别的属性，不是调用点的选择。
 * 开成参数就等于允许某一处的外链行上色。
 */
@Composable
fun LinkRow(label: String, onClick: () -> Unit, icon: Int?) {
    SettingsRow(
        label = label,
        interaction = RowInteraction.Clickable(onClick),
        icon = icon,
        iconFamily = SettingsIconFamily.Neutral,
    ) {
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_arrow_up_right_24_regular),
            contentDescription = null,
            tint = Theme.colors.textSecondary,
            modifier = Modifier.size(Theme.RowMetrics.trailingIconSize),
        )
    }
}

/**
 * 行内边距与最小触控高度的唯一声明（内边距 `16 × 12`、最小高 `52`）。
 *
 * 这一档只管「卡内主干行」。
 */
fun Modifier.preferenceRowPadding(): Modifier =
    this
        .heightIn(min = Theme.RowMetrics.minHeight)
        .padding(horizontal = Theme.Spacing.lg, vertical = Theme.RowMetrics.verticalPadding)

/** 区段小标题与它下面第一个容器之间 `6`。 */
private val SECTION_LABEL_GAP = 6.dp

/** 行标题在默认字号下的字号（dp）：图标列宽随它相对这一档的比例放大。 */
private val ROW_TITLE_REFERENCE = 15.dp
private const val GLYPH_BOX_PER_TYPE_SIZE = 24f / 20f
