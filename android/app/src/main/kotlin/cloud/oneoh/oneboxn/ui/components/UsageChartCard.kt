package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.TrafficFormat
import cloud.oneoh.oneboxn.core.UsageCell
import cloud.oneoh.oneboxn.core.UsageChartHit
import cloud.oneoh.oneboxn.core.UsageSeries
import cloud.oneoh.oneboxn.core.UsageTier
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.cardSurface
import cloud.oneoh.oneboxn.ui.hourLabel
import cloud.oneoh.oneboxn.ui.tabular
import cloud.oneoh.oneboxn.ui.usageDateLabel
import kotlin.math.max

// 账本某一档的卡片（汇总三项 + 柱图 + 起止刻度）。用量页与配置页的今日图共用同一件：
// 两处画的是同一种东西，各画一份必然在柱高归一、零值处置、刻度取端这三处慢慢分叉。
//
// 选中态是本件的内部状态：点某一格 → 汇总三项与刻度行改述该格，再点或
// 点图外空白取消；换档 / 换 profile 时随 series 一起重来。它不上抛、不持久化，故两处各自独立。
@Composable
fun UsageChartCard(series: UsageSeries, tier: UsageTier) {
    var selected by remember(series, tier) { mutableStateOf<Int?>(null) }
    val cell = selected?.let(series.cells::getOrNull)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(16.dp)
            // 图外空白取消选中：柱图自己的手势先消费落在图上的点按，这里只收剩下的。
            .pointerInput(series, tier) { detectTapGestures { selected = null } },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 三组「标签 + 数值」等分并排，等分落在三项自己身上，**不是靠中间两个弹性 Spacer 撑**：
        // 那种写法下项按内容宽、弹性全在槽上，选中换文字 ⇒ 槽重新平分 ⇒ 三项跟着挪，
        // 而选中态要的正是「位置不变」。
        // 槽宽零：与 Apple 的 `spacing: 0` 对齐，加一个就得两端一起改。
        Row(modifier = Modifier.fillMaxWidth()) {
            SummaryItem(
                R.string.device_usage_upload,
                TrafficFormat.bytes(cell?.up ?: series.totalUp),
                Modifier.weight(1f),
            )
            SummaryItem(
                R.string.device_usage_download,
                TrafficFormat.bytes(cell?.down ?: series.totalDown),
                Modifier.weight(1f),
            )
            SummaryItem(
                R.string.device_usage_sum,
                TrafficFormat.bytes(
                    cell?.let { it.up + it.down } ?: (series.totalUp + series.totalDown),
                ),
                Modifier.weight(1f),
            )
        }
        UsageBars(
            series = series,
            tier = tier,
            selectedIndex = selected,
            onTapCell = { index -> selected = if (selected == index) null else index },
            onStepTo = { index -> selected = index },
            onClearSelection = { selected = null },
        )
        // 选中时刻度行整行改述该格；未选中时回到首末格两端。行数与字阶不变，卡片高度恒定。
        Row(modifier = Modifier.fillMaxWidth()) {
            if (cell == null) {
                ScaleLabel(rangeLabel(series.cells.firstOrNull(), tier), Modifier)
                Spacer(Modifier.weight(1f))
                ScaleLabel(rangeLabel(series.cells.lastOrNull(), tier), Modifier)
            } else {
                ScaleLabel(selectedRangeLabel(cell, tier), Modifier.weight(1f), TextAlign.Center)
            }
        }
    }
}

@Composable
private fun ScaleLabel(
    text: String,
    modifier: Modifier = Modifier,
    align: TextAlign = TextAlign.Start,
) {
    Text(
        text = text,
        style = Theme.Type.meta.tabular(),
        color = Theme.colors.textSecondary,
        textAlign = align,
        modifier = modifier,
    )
}

@Composable
private fun SummaryItem(labelResId: Int, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = stringResource(labelResId),
            style = Theme.Type.meta,
            color = Theme.colors.textSecondary,
        )
        Text(
            text = value,
            style = Theme.Type.rowTitle.tabular(),
            fontWeight = FontWeight.Medium,
        )
    }
}

// 柱图：每格一根柱（离散区间量，形态同内存柱）；区间内全为 0 时不画柱——
// 画一排最小高度的柱会让「没用过」看着像「用了一点」。
@Composable
private fun UsageBars(
    series: UsageSeries,
    tier: UsageTier,
    selectedIndex: Int?,
    onTapCell: (Int) -> Unit,
    onStepTo: (Int) -> Unit,
    onClearSelection: () -> Unit,
) {
    val barColor = Theme.colors.accent
    val haptics = LocalHapticFeedback.current
    val cells = series.cells
    val selectedCell = selectedIndex?.let(cells::getOrNull)
    val label = stringResource(R.string.device_usage_chart) + ", " +
        stringResource(R.string.device_usage_chart_hint)
    // 未选中播报区间合计，选中播报该格的时间范围与三个数（读屏可达）。
    val state = if (selectedCell == null) {
        TrafficFormat.bytes(series.totalUp + series.totalDown)
    } else {
        selectedRangeLabel(selectedCell, tier) + ", " +
            stringResource(R.string.device_usage_upload) + " " + TrafficFormat.bytes(selectedCell.up) + ", " +
            stringResource(R.string.device_usage_download) + " " + TrafficFormat.bytes(selectedCell.down) + ", " +
            stringResource(R.string.device_usage_sum) + " " + TrafficFormat.bytes(selectedCell.up + selectedCell.down)
    }
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(USAGE_CHART_HEIGHT)
            .clip(RoundedCornerShape(Theme.Radius.control))
            .background(Theme.colors.fill)
            // 空图不挂手势：命中判据对零格 fail-fast，那是调用方 bug 而非运行期分支。
            .then(
                if (cells.isEmpty()) {
                    Modifier
                } else {
                    Modifier.pointerInput(cells.size) {
                        // 手势落点必在本图内（这是本 Modifier 的作用域），故可直接交给命中判据；
                        // core 的钳制只兜边缘的一两像素越界。
                        detectTapGestures { offset ->
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onTapCell(UsageChartHit.index(offset.x / size.width.toDouble(), cells.size))
                        }
                    }
                },
            )
            // 整图一个元素、但**可调整**：读屏没有坐标，只挂提示等于点不动。
            .clearAndSetSemantics {
                contentDescription = label
                stateDescription = state
                // 只有一格时不挂可调整语义：区间宽度为 0，读屏算百分比会除以零；
                // 而那种图本来也没有「上一格 / 下一格」可去。
                //
                // **区间下界是 -1 而不是 0**：-1 表示「未选中」。把未选中伪装成第 0 格会让
                // 读屏首次「增加」从 0 走到 1、跳过首格；-1 同时给了读屏一条取消选中的路，
                // 与 Apple 侧的取值约定逐字相同（那边 `selected ?? -1`）。
                if (cells.size >= 2) {
                    progressBarRangeInfo = ProgressBarRangeInfo(
                        current = (selectedIndex ?: NO_SELECTION).toFloat(),
                        range = NO_SELECTION.toFloat()..(cells.size - 1).toFloat(),
                        steps = cells.size - 1,
                    )
                    setProgress { target ->
                        val index = target.toInt().coerceIn(NO_SELECTION, cells.size - 1)
                        if (index == NO_SELECTION) onClearSelection() else onStepTo(index)
                        true
                    }
                }
            },
    ) {
        if (cells.isEmpty()) return@Canvas
        val peak = cells.maxOf { it.up + it.down }
        if (peak <= 0L) return@Canvas
        val gap = USAGE_BAR_GAP.toPx()
        val barWidth = (size.width - gap * (cells.size - 1)) / cells.size
        val minBarHeight = USAGE_MIN_BAR_HEIGHT.toPx()
        val radius = CornerRadius(USAGE_BAR_RADIUS.toPx(), USAGE_BAR_RADIUS.toPx())
        val ceiling = peak * USAGE_CHART_HEADROOM
        cells.forEachIndexed { index, cell ->
            val total = cell.up + cell.down
            if (total <= 0L) return@forEachIndexed
            val barHeight = max(minBarHeight, (total / ceiling) * size.height)
            // **柱一律 accent，选中与否不改柱本身**：柱承载的是那一天的数据——压暗它丢的是
            // 那个数本身，不是一条状态提示。
            drawRoundRect(
                color = barColor,
                topLeft = Offset(index * (barWidth + gap), size.height - barHeight),
                size = Size(barWidth, barHeight),
                cornerRadius = radius,
            )
        }
        // **选中格由轨道顶端一条标记表达，它是「选中」唯一的通道**（柱不随选中态变）。
        // 挂在轨道顶端而不是柱顶：零值格没有柱却同样可选中，挂在柱上的标记恰好在那一格缺席；
        // 故这一段在上面那个 `total <= 0L` 的提前返回之外，不进那个循环。
        // 尺寸（高 `4` / 圆角 `2` / 距轨顶 `4` / 宽同柱）是下限，不按本端密度缩：
        // 它自己压轨道要过 `3:1`（accent 压 fill = 5.05 / 3.50）。
        selectedIndex?.let { selected ->
            if (selected in cells.indices) {
                drawRoundRect(
                    color = barColor,
                    topLeft = Offset(selected * (barWidth + gap), USAGE_MARK_INSET.toPx()),
                    size = Size(barWidth, USAGE_MARK_HEIGHT.toPx()),
                    cornerRadius = CornerRadius(USAGE_MARK_RADIUS.toPx(), USAGE_MARK_RADIUS.toPx()),
                )
            }
        }
    }
}

// 刻度：两端都取所在格的**起始**时刻——右端若取末格的结束时刻，今日会写成次日 00:00
// （与左端字面相同，读起来像坏了），近 30 天 / 半年则会写出一个明天的日期。
// 今日给起止小时，其余给起止日期；两者都经固定 locale 格式化。
private fun rangeLabel(cell: UsageCell?, tier: UsageTier): String {
    if (cell == null) return ""
    val epochSeconds = cell.startHourUtc * 3600
    return if (tier == UsageTier.TODAY) hourLabel(epochSeconds) else usageDateLabel(epochSeconds)
}

// 选中格的时间范围：这里**要**用结束时刻——它是「这一格覆盖到哪」的答案，
// 而上面那条刻度是「图从哪开始 / 到哪结束」的答案，两者是不同的问题。
// 结束边界是开区间，故日期档回退一小时落在该格最后一天上。
private fun selectedRangeLabel(cell: UsageCell, tier: UsageTier): String {
    val start = cell.startHourUtc * 3600
    val end = cell.endHourUtc * 3600
    return when (tier) {
        UsageTier.TODAY -> "${hourLabel(start)} – ${hourLabel(end)}"
        UsageTier.MONTH -> usageDateLabel(start)
        UsageTier.HALF_YEAR -> "${usageDateLabel(start)} – ${usageDateLabel(end - 3600)}"
    }
}

private val USAGE_CHART_HEIGHT = 120.dp
private val USAGE_BAR_GAP = 1.dp
private val USAGE_BAR_RADIUS = 2.dp
private val USAGE_MIN_BAR_HEIGHT = 2.dp

/** 柱高归一的顶部余量系数：与内存柱同款，峰值不顶满容器。 */
private const val USAGE_CHART_HEADROOM = 1.2f

/** 选中标记：轨道顶端一条 `accent`，**这是「选中」唯一的通道**；没有任何状态让它消失。 */
private val USAGE_MARK_HEIGHT = 4.dp
private val USAGE_MARK_RADIUS = 2.dp
private val USAGE_MARK_INSET = 4.dp

/** 可调整语义里「未选中」的取值：与 Apple 侧 `selected ?? -1` 同一约定。 */
private const val NO_SELECTION = -1
