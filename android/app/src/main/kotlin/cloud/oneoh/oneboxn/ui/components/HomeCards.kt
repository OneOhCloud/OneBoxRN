package cloud.oneoh.oneboxn.ui.components

import android.os.SystemClock
import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.LatencyReading
import cloud.oneoh.oneboxn.ui.MILLIS_PER_SECOND
import cloud.oneoh.oneboxn.ui.Motion
import cloud.oneoh.oneboxn.ui.NodeNameLines
import cloud.oneoh.oneboxn.ui.SessionDuration
import cloud.oneoh.oneboxn.ui.StatsViewModel
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.Tone
import cloud.oneoh.oneboxn.ui.cardSurface
import cloud.oneoh.oneboxn.ui.motionSpec
import cloud.oneoh.oneboxn.ui.sessionDurationOf
import cloud.oneoh.oneboxn.ui.tabular
import cloud.oneoh.oneboxn.ui.tier
import cloud.oneoh.oneboxn.ui.tone
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.delay

// 首页组位里的卡：已连接是会话卡，未连接是配置卡（[ProfileSummaryCard]），启动失败是失败卡。
// 三张卡同宽同高、同一副网格，组位按这一个高度预留，四态之间电源砖不动。

/** 首页卡网格里别的卡也要对齐的几项；配置卡（[ProfileSummaryCard]）坐进同一副网格，故对组件包开放。 */
internal object HomeCardMetrics {
    val inset = Theme.Spacing.lg
    val radius = Theme.Radius.panel

    /** 可按的卡要先裁成这个形状，按下填充才不溢出圆角。 */
    val shape = RoundedCornerShape(radius)
    val badgeToTitle = Theme.Spacing.md
    val titleToChevron = Theme.Spacing.sm
    val nameToCaption = 2.dp

    /** 左上圆位的直径：随 [Theme.Type.latencyDigits] 同比缩放。 */
    @Composable
    fun badgeDiameter(): Dp = scaledWith(Theme.Type.latencyDigits, BADGE_DIAMETER)
}

private val BADGE_DIAMETER = 44.dp
private val NOTE_TO_CHEVRON = Theme.Spacing.xs
private val ROW_TO_BAND = Theme.Spacing.lg
private val BAND_HEIGHT = 36.dp
private val CELL_GAP = Theme.Spacing.sm
private val READOUT_ICON_SIZE = 10.dp
private val READOUT_ICON_TO_VALUE = Theme.Spacing.xs
private val TESTING_INDICATOR_SIZE = 14.dp
private val TESTING_INDICATOR_STROKE = 2.dp

/** 读数带左格的宽度份额（中右两格各一份）：左格是箭头加速率，比纯数字宽一截。 */
private const val SPEED_CELL_SHARE = 1.1f

/** 圆位里加号 / 感叹号占直径的比例。 */
private const val SYMBOL_RATIO = 0.46f

/** 四位数起降一档字号。 */
private const val COMPACT_DIGITS_FROM = 1_000

private const val LATENCY_UNIT = "ms"

/** 已连接时组位里那张会话卡的全部读数。 */
@Immutable
data class SessionReadings(
    val node: NodeNameLines,
    val latency: LatencyReading,
    val downloadRate: String,
    val uploadRate: String,
    val usage: String,
    /** 本次会话连上的时刻（`SystemClock.elapsedRealtime` 口径）；不在会话里为 null。时长按它每秒现算。 */
    val startedAt: Long?,
)

/** 启动失败的失败卡：左上图形、标题与说明。 */
@Immutable
data class HomeEntryContent(
    @param:DrawableRes val icon: Int,
    val tone: Tone,
    val title: String,
    /** 标题色：失败卡的错误色只给图形与标题，说明与「›」仍是次要色。 */
    val titleColor: Color,
    val note: String,
)

/**
 * 与 [anchor] 那一档字同比缩放的尺寸：动态字号放大时，圆位与读数带跟着字一起长——
 * 三张卡都走这一副网格，任何字号下仍一样高，组位不跳。按实际换算而不是乘 `fontScale`：
 * 大字号下系统对大字放大得更少，线性乘会让圆位比里面的字长得快。
 */
@Composable
private fun scaledWith(anchor: TextStyle, base: Dp): Dp {
    val nominal = anchor.fontSize.value.dp
    val actual = with(LocalDensity.current) { anchor.fontSize.toDp() }
    return base * (actual / nominal)
}

/** 三张卡的共同网格：上排与圆位同高，下排是读数带。 */
@Composable
internal fun HomeCardGrid(
    modifier: Modifier,
    top: @Composable (badgeDiameter: Dp) -> Unit,
    band: @Composable () -> Unit,
) {
    val badgeDiameter = HomeCardMetrics.badgeDiameter()
    val bandHeight = scaledWith(Theme.Type.emptyTitle, BAND_HEIGHT)
    Column(
        verticalArrangement = Arrangement.spacedBy(ROW_TO_BAND),
        modifier = modifier
            .fillMaxWidth()
            .padding(HomeCardMetrics.inset),
    ) {
        Box(Modifier.fillMaxWidth().height(badgeDiameter)) { top(badgeDiameter) }
        Box(Modifier.fillMaxWidth().height(bandHeight)) { band() }
    }
}

/** 左上的圆位：会话卡里是延迟读数，失败卡里是入口图形；配置卡在同一格放站标砖。三张卡同一个位置。 */
private sealed interface BadgeContent {
    /** 节点延迟：圆位底色取档位容器色、字取档位前景色。 */
    data class Latency(val reading: LatencyReading) : BadgeContent

    /** 入口图形：前景与圆位底色取同一对语义色。 */
    data class Symbol(@param:DrawableRes val icon: Int, val tone: Tone) : BadgeContent
}

@Composable
private fun HomeCardBadge(content: BadgeContent, diameter: Dp) {
    val tone = when (content) {
        is BadgeContent.Latency -> content.reading.tier.tone()
        is BadgeContent.Symbol -> content.tone
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(diameter)
            .background(tone.container, CircleShape),
    ) {
        when (content) {
            is BadgeContent.Latency -> LatencyBadgeReading(content.reading, tone.fg)
            is BadgeContent.Symbol -> Icon(
                painter = painterResource(content.icon),
                contentDescription = null,
                tint = tone.fg,
                modifier = Modifier.size(diameter * SYMBOL_RATIO),
            )
        }
    }
}

@Composable
private fun LatencyBadgeReading(reading: LatencyReading, color: Color) {
    when (reading) {
        is LatencyReading.Measured -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val digits = if (reading.millis >= COMPACT_DIGITS_FROM) {
                Theme.Type.latencyDigitsCompact
            } else {
                Theme.Type.latencyDigits
            }
            Text(text = reading.millis.toString(), style = digits.tabular(), color = color, maxLines = 1)
            Text(text = LATENCY_UNIT, style = Theme.Type.latencyUnit, color = color, maxLines = 1)
        }
        LatencyReading.Testing -> CircularProgressIndicator(
            color = Theme.colors.textSecondary,
            strokeWidth = TESTING_INDICATOR_STROKE,
            modifier = Modifier.size(TESTING_INDICATOR_SIZE),
        )
        LatencyReading.Absent -> Text(
            text = StatsViewModel.PLACEHOLDER,
            style = Theme.Type.latencyDigits.copy(fontWeight = FontWeight.SemiBold),
            color = color,
        )
    }
}

/** 「›」：会话卡跟在节点行尾，配置卡跟在名称行尾，失败卡跟在说明之后，说的都是「点开还有一层」。 */
@Composable
internal fun HomeCardChevron() {
    Icon(
        painter = painterResource(FluentR.drawable.ic_fluent_chevron_right_24_regular),
        contentDescription = null,
        tint = Theme.colors.textSecondary,
        modifier = Modifier.size(Theme.RowMetrics.trailingIconSize),
    )
}

/** 按下时的行底：与设置行、配置行同一种反馈（整块填充换色），不加涟漪。 */
@Composable
internal fun pressedFill(interactionSource: MutableInteractionSource, rest: Color): Color {
    val pressed by interactionSource.collectIsPressedAsState()
    val fill by animateColorAsState(
        targetValue = if (pressed) Theme.colors.rowActive else rest,
        animationSpec = motionSpec(Motion.ROW_MS),
        label = "homeCardFill",
    )
    return fill
}

/** 已连接：节点行在上，读数带在下（网速 · 本次时长 · 本次用量）。 */
@Composable
fun SessionCard(readings: SessionReadings, onSelectNode: () -> Unit, modifier: Modifier = Modifier) {
    HomeCardGrid(
        modifier = modifier.cardSurface(HomeCardMetrics.radius),
        top = { diameter -> NodeRow(readings, diameter, onSelectNode) },
        band = {
            Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP), modifier = Modifier.fillMaxSize()) {
                SpeedCell(readings, Modifier.weight(SPEED_CELL_SHARE).fillMaxHeight())
                DurationCell(readings.startedAt, Modifier.weight(1f).fillMaxHeight())
                ValueCell(
                    value = readings.usage,
                    label = stringResource(R.string.home_session_usage),
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
            }
        },
    )
}

@Composable
private fun NodeRow(readings: SessionReadings, badgeDiameter: Dp, onSelectNode: () -> Unit) {
    val interactionSource = remember { MutableInteractionSource() }
    val label = nodeRowLabel(readings)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(Theme.Radius.control))
            .background(pressedFill(interactionSource, Color.Transparent))
            .clickable(interactionSource = interactionSource, indication = null, role = Role.Button, onClick = onSelectNode)
            // 圆位里的数字与「ms」是两段字，不收拢会分开读；整行读成一句：节点选择，完整名称，延迟。
            .semantics { contentDescription = label },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.clearAndSetSemantics { },
        ) {
            HomeCardBadge(BadgeContent.Latency(readings.latency), badgeDiameter)
            Column(
                verticalArrangement = Arrangement.spacedBy(HomeCardMetrics.nameToCaption),
                modifier = Modifier
                    .weight(1f)
                    .padding(start = HomeCardMetrics.badgeToTitle, end = HomeCardMetrics.titleToChevron),
            ) {
                Text(
                    text = readings.node.name,
                    style = Theme.Type.sheetTitle,
                    color = Theme.colors.textPrimary,
                    maxLines = 1,
                    // 节点名多是「地区 … 编号 / 倍率」，同地区的几个只在结尾不同：尾部省略会把它们截成同一串。
                    overflow = TextOverflow.MiddleEllipsis,
                )
                readings.node.autoCaption?.let { caption ->
                    Text(
                        text = caption,
                        style = Theme.Type.subtitle,
                        color = Theme.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            HomeCardChevron()
        }
    }
}

@Composable
private fun nodeRowLabel(readings: SessionReadings): String {
    val parts = listOf(stringResource(R.string.home_node_label)) + readings.node.spoken
    val delay = (readings.latency as? LatencyReading.Measured)
        ?.let { stringResource(R.string.nodes_delay, it.millis) }
    return (parts + listOfNotNull(delay)).joinToString(", ")
}

/** 左格：下行在上、上行在下，与运行统计页数值行同序。 */
@Composable
private fun SpeedCell(readings: SessionReadings, modifier: Modifier) {
    Column(verticalArrangement = Arrangement.SpaceBetween, modifier = modifier) {
        SpeedReadout(
            icon = FluentR.drawable.ic_fluent_arrow_down_24_filled,
            value = readings.downloadRate,
            accessibility = stringResource(R.string.home_download, readings.downloadRate),
        )
        SpeedReadout(
            icon = FluentR.drawable.ic_fluent_arrow_up_24_filled,
            value = readings.uploadRate,
            accessibility = stringResource(R.string.home_upload, readings.uploadRate),
        )
    }
}

/** 速率读数：箭头 + 等宽数值（高频变化防跳动）。数值取次级色：大数字留给时长与用量。 */
@Composable
private fun SpeedReadout(@DrawableRes icon: Int, value: String, accessibility: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(READOUT_ICON_TO_VALUE),
        modifier = Modifier.clearAndSetSemantics { contentDescription = accessibility },
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            tint = Theme.colors.textSecondary,
            modifier = Modifier.size(READOUT_ICON_SIZE),
        )
        Text(
            text = value,
            style = Theme.Type.subtitle.tabular(),
            color = Theme.colors.textSecondary,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/** 不在会话里就不起秒表：一个每秒重算的时钟没有东西可读时不该一直跑着。 */
@Composable
private fun DurationCell(startedAt: Long?, modifier: Modifier) {
    val duration = if (startedAt == null) {
        SessionDuration.Absent
    } else {
        val now by rememberSessionClock(startedAt)
        sessionDurationOf(startedAt, now)
    }
    ValueCell(
        value = when (duration) {
            SessionDuration.Absent -> StatsViewModel.PLACEHOLDER
            is SessionDuration.Clock -> duration.text
            is SessionDuration.Days -> stringResource(R.string.home_session_days, duration.days, duration.hoursMinutes)
        },
        label = stringResource(R.string.home_session_duration),
        modifier = modifier,
    )
}

/** 按会话起点对齐到整秒翻一次：读数在整秒处跳，不随组合发生的时刻漂出半拍。 */
@Composable
private fun rememberSessionClock(startedAt: Long) = produceState(SystemClock.elapsedRealtime(), startedAt) {
    while (true) {
        value = SystemClock.elapsedRealtime()
        delay(MILLIS_PER_SECOND - (value - startedAt).mod(MILLIS_PER_SECOND))
    }
}

/** 中格与右格：大数字在上、小标题在下。读屏读成「标题，数值」。 */
@Composable
private fun ValueCell(value: String, label: String, modifier: Modifier) {
    Column(
        verticalArrangement = Arrangement.SpaceBetween,
        modifier = modifier.clearAndSetSemantics { contentDescription = "$label, $value" },
    ) {
        Text(
            text = value,
            style = Theme.Type.emptyTitle.tabular(),
            color = Theme.colors.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = label,
            style = Theme.Type.meta,
            color = Theme.colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * 启动失败的失败卡：整卡一个按钮。上排是图形位 + 标题，与会话卡的节点行同一副排法；
 * 说明带「›」贴读数带底边靠右——连上之后圆位里换成延迟读数、读数带里换成三格，位置都不动。
 * 读屏按标题、说明的顺序读；两枚图形不带描述，不会被念成图标名。
 */
@Composable
fun HomeEntryCard(content: HomeEntryContent, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interactionSource = remember { MutableInteractionSource() }
    val shape = HomeCardMetrics.shape
    HomeCardGrid(
        modifier = modifier
            .clip(shape)
            .background(pressedFill(interactionSource, Theme.colors.surface), shape)
            .clickable(interactionSource = interactionSource, indication = null, role = Role.Button, onClick = onClick),
        top = { diameter ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxSize()) {
                HomeCardBadge(BadgeContent.Symbol(content.icon, content.tone), diameter)
                Text(
                    text = content.title,
                    style = Theme.Type.emptyTitle,
                    color = content.titleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = HomeCardMetrics.badgeToTitle),
                )
            }
        },
        band = {
            Box(contentAlignment = Alignment.BottomEnd, modifier = Modifier.fillMaxSize()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(NOTE_TO_CHEVRON, Alignment.End),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = content.note,
                        style = Theme.Type.status.copy(fontWeight = FontWeight.Normal),
                        color = Theme.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        // 不撑满：短说明靠右贴着「›」；长说明只分到「›」量完之后剩下的宽度，截尾而「›」不被挤掉。
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    HomeCardChevron()
                }
            }
        },
    )
}
