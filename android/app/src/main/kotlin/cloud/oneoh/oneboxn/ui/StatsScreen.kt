package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.CurvePoint
import cloud.oneoh.oneboxn.core.MemoryTrend
import cloud.oneoh.oneboxn.core.RateSample
import cloud.oneoh.oneboxn.core.CurveSmoothing
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.core.ByteParts
import cloud.oneoh.oneboxn.core.TrafficFormat
import cloud.oneoh.oneboxn.core.TrafficRateTrend
import cloud.oneoh.oneboxn.ui.components.EmptyState
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlin.math.max

// 运行统计页：入/出站连接数卡片对在前，
// 其后是引擎内存独立区（数值 + 60 秒趋势 + 峰值）与网速区。数据与主页速率行同源同拍（同一 Traffic 快照）；
// 未连接走空态而非展示陈旧数字。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(onBack: () -> Unit) {
    val vm: StatsViewModel = viewModel { StatsViewModel(app.actions) }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.stats_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_chevron_left_24_regular),
                            contentDescription = stringResource(R.string.back),
                        )
                    }
                },
                colors = pageTopBarColors(),
            )
        },
    ) { padding ->
        if (!vm.connected) {
            // 未连接时 Traffic 停在最后一帧，故整页走空态，绝不展示陈旧数字。
            EmptyState(
                icon = painterResource(FluentR.drawable.ic_fluent_power_24_regular),
                title = stringResource(R.string.stats_disconnected),
                caption = stringResource(R.string.stats_disconnected_note),
                // 水平边距 = 本页页边距（同内容支那一份 `Theme.Spacing.lg`）。
                modifier = Modifier.padding(padding).readableContentWidth().padding(horizontal = Theme.Spacing.lg),
            )
            return@Scaffold
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .readableContentWidth()
                .padding(horizontal = Theme.Spacing.lg)
                .padding(top = Theme.Spacing.lg, bottom = Theme.Spacing.md),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // 已连接不代表读数是新的。断流期整页转占位，并显式说明为什么没有数字
            // ——只把数字换成「—」而不给理由，用户读到的是「坏了」而不是「暂时没有数据」。
            if (vm.stale) StalledNote()
            // 连接数在前：两个瞬时整数读一眼就走，两块随时间演化的图排在其后。
            // height(IntrinsicSize.Min) + 各卡 fillMaxHeight：两张卡等高，且高度只取两者中更高的自然高度。
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
            ) {
                connectionCards(vm.connectionsIn, vm.connectionsOut).forEach { card ->
                    ConnectionCard(
                        label = stringResource(card.labelResId),
                        value = card.value,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                }
            }
            MemoryCard(parts = vm.memoryParts, trend = vm.displayMemoryTrend, peakLabel = vm.memoryPeak)
            SpeedCard(trend = vm.displayRateTrend, upLabel = vm.uploadRate, downLabel = vm.downloadRate)
            // 页脚注记：说明内存读数的口径，并给出更省内存的选择（与 OneBoxNative 的有意差异）。
            Text(
                text = stringResource(R.string.stats_engine_memory_note),
                style = Theme.Type.subtitle,
                color = Theme.colors.textSecondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

internal data class ConnectionCardState(val labelResId: Int, val value: String)

/** 连接数卡片对的顺序权威（两端必须同序，Apple 侧对手方测试见 ios/AppTests/StatsOrderTests.swift）。 */
internal fun connectionCards(connectionsIn: String, connectionsOut: String): List<ConnectionCardState> =
    listOf(
        // 连接数为纯整数不加单位。内存与网速各有独立区域，不占本卡片对。
        ConnectionCardState(R.string.stats_conn_in, connectionsIn),
        ConnectionCardState(R.string.stats_conn_out, connectionsOut),
    )

// 断流提示：不是错误弹层，只是一行如实说明——隧道照常转发，停的是观察通道。
@Composable
private fun StalledNote() {
    Text(
        text = stringResource(R.string.stats_stalled),
        style = Theme.Type.subtitle,
        color = Theme.colors.textSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(12.dp),
    )
}

// 内存区：全页唯一的英雄数字 + 最近 60 秒走势 + 会话峰值。
// 内存无上限/配额，故不做百分比仪表，只给绝对量与走势参照。
@Composable
private fun MemoryCard(parts: ByteParts, trend: MemoryTrend, peakLabel: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.stats_memory).uppercase(),
            style = Theme.Type.sectionLabel,
            color = Theme.colors.textSecondary,
            // **卡内标题也要上报「标题」语义**——
            // 读屏有「按标题跳转」的转子/手势，没有这个特性的标题只是一个普通停留点。
            // **与之同处的例外**：标题行**右侧的注记**（`stats_window`「最近 60 秒」）**不报**，
            // 念成标题是噪音。**这四处不走 `SectionHeader`**：那一件带
            // `padding(horizontal = 4.dp)`，是给**卡外**小标题的内缩，
            // 而这里是卡内（`padding(16.dp)` 之内）。
            modifier = Modifier.semantics { heading() },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = parts.value,
                style = Theme.Type.pageTitle.tabular(),
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.alignByBaseline(),
            )
            Text(
                text = parts.unit,
                style = Theme.Type.status,
                color = Theme.colors.textSecondary,
                modifier = Modifier.alignByBaseline(),
            )
        }
        MemorySparkline(trend, peakLabel)
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.stats_window),
                style = Theme.Type.meta,
                color = Theme.colors.textSecondary,
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(R.string.stats_memory_peak, peakLabel),
                style = Theme.Type.meta.tabular(),
                color = Theme.colors.textSecondary,
            )
        }
    }
}

// 网速区：同基线双色面积图 + 下载/上传读数。
// 两条共用同一归一分母，故高度比恒等于两个速率之比。
@Composable
private fun SpeedCard(trend: TrafficRateTrend, upLabel: String, downLabel: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.stats_speed).uppercase(),
                style = Theme.Type.sectionLabel,
                color = Theme.colors.textSecondary,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.weight(1f))
            // **这一处不挂 `heading()`**：它是标题行右侧的注记，
            // 与左侧的标题同档同色，**而它标注的不是一块内容**——念成标题是噪音。
            Text(
                text = stringResource(R.string.stats_window).uppercase(),
                style = Theme.Type.sectionLabel,
                color = Theme.colors.textSecondary,
            )
        }
        SpeedAreaChart(trend = trend, upLabel = upLabel, downLabel = downLabel)
        // 左下载、右上传（先看下载）；与主页速率行同序。
        Row(modifier = Modifier.fillMaxWidth()) {
            SpeedReadout(FluentR.drawable.ic_fluent_arrow_down_24_regular, R.string.stats_download_rate, downLabel)
            Spacer(Modifier.weight(1f))
            SpeedReadout(FluentR.drawable.ic_fluent_arrow_up_24_regular, R.string.stats_upload_rate, upLabel)
        }
    }
}

// 方向由图标表达，不只靠位置或颜色；数值等宽防抖动。
@Composable
private fun SpeedReadout(iconResId: Int, labelResId: Int, value: String) {
    val description = "${stringResource(labelResId)}, $value"
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.clearAndSetSemantics { contentDescription = description },
    ) {
        Icon(
            painter = painterResource(iconResId),
            contentDescription = null,
            tint = Theme.colors.textSecondary,
            modifier = Modifier.size(SPEED_ICON_SIZE),
        )
        Text(
            text = value,
            style = Theme.Type.subtitle.tabular(),
        )
    }
}

// 同基线双色面积图：两条都自底边向上生长、靠颜色区分，共享分母 = 窗口峰值 × 1.2。
// 逐段闭合（断流留白——跨越缺口的连线会把没有数据的那段画成「一直在跑」）；
// x 按样本时刻定位，y 按共享分母归一。
@Composable
private fun SpeedAreaChart(trend: TrafficRateTrend, upLabel: String, downLabel: String) {
    val chart = Theme.chartSeries
    val description = stringResource(R.string.stats_speed_trend) + ", " + downLabel + ", " + upLabel
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(SPEED_CHART_HEIGHT)
            .clip(RoundedCornerShape(Theme.Radius.control))
            .background(Theme.colors.fill)
            .clearAndSetSemantics { contentDescription = description },
    ) {
        val ceiling = trend.peak * SPEED_CHART_HEADROOM
        if (ceiling <= 0f) return@Canvas
        val baseline = size.height
        val windowStart = trend.windowStartMillis
        val span = TrafficRateTrend.WINDOW_MILLIS.toFloat()

        // 归一坐标 → 像素：两条序列同基线、同一映射，没有方向分支。
        fun pixel(point: CurvePoint): Offset =
            Offset((point.x * size.width).toFloat(), baseline - (point.y * baseline).toFloat())

        // 一条序列的所有断流段：outline 只到曲线顶缘，area 再闭合到基线。
        // 两者共用同一条曲线，故填充与描边逐像素对齐。
        // 首末 x 随路径一起带出来，而不是事后问 Path.getBounds()——那要额外假定
        // 「曲线的包围盒不被控制点撑宽」，虽然本算法确实保证了，但没必要依赖这层间接。
        fun outlines(valueOf: (RateSample) -> Long): List<SpeedOutline> = trend.segments().mapNotNull { segment ->
            if (segment.size < 2) return@mapNotNull null
            // 归一坐标交给 core 平滑，像素映射留在这里：曲线形状是两端必须一致的可观察结果，
            // 各画各的必然背离且肉眼看不出（夹具 golden/curve-smoothing.json）。
            val normalized = segment.map { sample ->
                CurvePoint(
                    x = ((sample.atMillis - windowStart) / span).coerceIn(0f, 1f).toDouble(),
                    y = (valueOf(sample) / ceiling).coerceAtMost(1f).toDouble(),
                )
            }
            val curve = CurveSmoothing.smooth(normalized)
            if (curve.isEmpty()) return@mapNotNull null
            val start = pixel(normalized.first())
            val path = Path().apply {
                moveTo(start.x, start.y)
                for (piece in curve) {
                    val c1 = pixel(piece.control1)
                    val c2 = pixel(piece.control2)
                    val end = pixel(piece.end)
                    cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
                }
            }
            SpeedOutline(path = path, startX = start.x, endX = pixel(curve.last().end).x)
        }

        val downloadOutlines = outlines { it.down }
        val uploadOutlines = outlines { it.up }

        fun fill(outline: SpeedOutline, color: Color) {
            val area = Path().apply {
                addPath(outline.path)
                lineTo(outline.endX, baseline)
                lineTo(outline.startX, baseline)
                close()
            }
            // 面积填充是**恒定**淡度，不随任何状态变；曲线本身满不透明，读数由曲线与其下的数字承担，面积只是底衬。
            drawPath(area, color, alpha = SPEED_FILL_ALPHA)
        }

        // **先两条填充、后两条描边**：值小的那条整个落在大的那条区间内是常态，
        // 若逐条「填充完就描边」，后画的填充会把先画的描边盖住，小的那条照样看不见。
        downloadOutlines.forEach { fill(it, chart.download) }
        uploadOutlines.forEach { fill(it, chart.upload) }
        val stroke = Stroke(width = SPEED_STROKE_WIDTH.toPx())
        downloadOutlines.forEach { drawPath(it.path, chart.download, style = stroke) }
        uploadOutlines.forEach { drawPath(it.path, chart.upload, style = stroke) }
    }
}

// 一条断流段的曲线顶缘 + 它在基线上的两个端点 x（填充闭合用）。
private class SpeedOutline(val path: Path, val startX: Float, val endX: Float)

private val SPEED_CHART_HEIGHT = 72.dp
private val SPEED_ICON_SIZE = 14.dp
private val SPEED_STROKE_WIDTH = 2.dp

/** 归一分母的顶部余量系数：与内存柱同款，峰值不顶满容器。 */
private const val SPEED_CHART_HEADROOM = 1.2f

/** 两条序列的填充不透明度：跨端视觉契约，不由各端自选。 */
private const val SPEED_FILL_ALPHA = 0.35f

// 趋势柱条：每拍一根柱（离散，不插值），按样本时刻定位、最新在右，缓冲未满时左侧留空。
// 柱高按**窗口**峰值归一（内存无绝对上限，参照只能是窗口自身）；无障碍播报的峰值
// 用展示层峰值串（会话峰值，降级窗口峰值）——两个峰值分属两个语义，不混用。
@Composable
private fun MemorySparkline(trend: MemoryTrend, peakLabel: String) {
    val barColor = Theme.colors.accent
    val description = stringResource(R.string.stats_memory_trend) +
        ", " + TrafficFormat.bytes(trend.samples.lastOrNull()?.bytes ?: 0L) +
        ", " + stringResource(R.string.stats_memory_peak, peakLabel)
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(SPARKLINE_HEIGHT)
            .clip(RoundedCornerShape(Theme.Radius.control))
            .background(Theme.colors.fill)
            .clearAndSetSemantics { contentDescription = description },
    ) {
        val peak = trend.peak
        if (peak <= 0L) return@Canvas
        val gap = SPARKLINE_BAR_GAP.toPx()
        val barWidth = (size.width - gap * (MemoryTrend.BAR_COUNT - 1)) / MemoryTrend.BAR_COUNT
        val minBarHeight = SPARKLINE_MIN_BAR_HEIGHT.toPx()
        val radius = CornerRadius(SPARKLINE_BAR_RADIUS.toPx(), SPARKLINE_BAR_RADIUS.toPx())
        // 归一分母 = 窗口峰值 × 1.2：顶部留两成余量，峰值柱才不会顶满容器
        // ——顶满时看不出「这一根就是峰值」，也没有再涨的视觉空间。
        val ceiling = peak * SPARKLINE_HEADROOM
        val span = MemoryTrend.WINDOW_MILLIS.toFloat()
        // 柱子按**样本时刻**定位、**右缘**对齐该时刻：最新一拍恒贴右边缘，缺帧的那几秒
        // 就是那么宽的一段空白。不量化到秒格——投递延迟逐帧不同，落格会让延迟大的那根柱
        // 撞进邻格被丢弃，本该有柱的那一秒反而变成空白。正在滑出窗口的柱由容器裁切。
        trend.bars().forEach { bar ->
            val barHeight = max(minBarHeight, (bar.bytes.toFloat() / ceiling) * size.height)
            val right = (bar.offsetMillis / span) * size.width
            drawRoundRect(
                color = barColor,
                topLeft = Offset(right - barWidth, size.height - barHeight),
                size = Size(barWidth, barHeight),
                cornerRadius = radius,
            )
        }
    }
}

private val SPARKLINE_HEIGHT = 48.dp
private val SPARKLINE_BAR_GAP = 1.dp
private val SPARKLINE_BAR_RADIUS = 2.dp
private val SPARKLINE_MIN_BAR_HEIGHT = 2.dp

/** 柱高归一的顶部余量系数：分母取窗口峰值的 1.2 倍。 */
private const val SPARKLINE_HEADROOM = 1.2f

// 连接数卡片：展示态不可点；值用等宽数字（每秒刷新，非等宽会抖动）。
@Composable
private fun ConnectionCard(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = modifier
            .cardSurface()
            .padding(16.dp),
    ) {
        Text(
            text = label.uppercase(),
            style = Theme.Type.sectionLabel,
            color = Theme.colors.textSecondary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = value,
            style = Theme.Type.rowTitle.tabular(),
            fontWeight = FontWeight.Medium,
        )
    }
}
