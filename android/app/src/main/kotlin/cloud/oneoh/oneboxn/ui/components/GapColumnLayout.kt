package cloud.oneoh.oneboxn.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** 一条缝的分配规则：自由空间按 [weight] 成比例分到各缝；按比例分到的份额低于 [minimum] 时钉在下限。 */
@Immutable
data class GapRule(val minimum: Dp, val weight: Float)

object GapDistribution {
    /**
     * 把 [free] 分给各缝：先按权重成比例分，份额不足下限的缝钉在下限，其余缝就剩下的空间重新按权重分，
     * 直到没有缝再被钉住。空间连下限都凑不齐时全部取下限（总和超出 [free]，由外层滚动吸收）。
     */
    fun sizes(free: Dp, rules: List<GapRule>): List<Dp> {
        require(rules.isNotEmpty()) { "至少要有一条缝" }
        require(rules.all { it.minimum >= 0.dp && it.weight >= 0f }) { "下限与权重不得为负" }
        val pinned = mutableSetOf<Int>()
        while (true) {
            val open = rules.indices.filterNot { it in pinned }
            val openWeight = open.sumOf { rules[it].weight.toDouble() }.toFloat()
            if (openWeight <= 0f) break
            val pinnedTotal = pinned.fold(0.dp) { total, index -> total + rules[index].minimum }
            val unit = (free - pinnedTotal).coerceAtLeast(0.dp) / openWeight
            val starved = open.filter { unit * rules[it].weight < rules[it].minimum }
            if (starved.isEmpty()) {
                return rules.indices.map { if (it in pinned) rules[it].minimum else unit * rules[it].weight }
            }
            pinned += starved
        }
        return rules.map { it.minimum }
    }
}

/**
 * 一列的缝：[gaps] 按 [GapDistribution] 分余量，分完再从末缝挪 [drop] 到首缝——
 * 整列内容下移这么多，而不是再按权重稀释；末缝不低于它的下限。
 */
@Immutable
data class GapColumnRules(val gaps: List<GapRule>, val drop: Dp = 0.dp) {
    init {
        require(gaps.isNotEmpty()) { "至少要有一条缝" }
        require(drop >= 0.dp) { "下移量不得为负" }
    }

    /** 列高扣掉各子项高，剩下的按 [gaps] 分给各缝，自上而下。 */
    fun gapSizes(columnHeight: Dp, itemHeights: List<Dp>): List<Dp> {
        val free = itemHeights.fold(columnHeight) { rest, height -> rest - height }
        val sizes = GapDistribution.sizes(free, gaps).toMutableList()
        val last = sizes.lastIndex
        val moved = minOf(drop, (sizes[last] - gaps[last].minimum).coerceAtLeast(0.dp))
        sizes[0] += moved
        sizes[last] -= moved
        return sizes
    }
}

/**
 * 竖排：子项按声明序自上而下，子项之间与首尾共 `子项数 + 1` 条缝，缝宽由 [GapColumnRules] 分。
 *
 * **子项只取自身的自然高**，自由空间全部归缝——子项里谁想「撑满」都撑不开，余量归属不靠每一支自觉。
 * 列高取外层给的最小高与「子项 + 缝下限」两者较大者：放在滚动容器里时最大高是无穷，
 * **目标高只能来自外层的 `heightIn(min = …)`**，去掉它所有缝都会静默塌到下限。
 */
@Composable
fun GapColumn(rules: GapColumnRules, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Layout(content = content, modifier = modifier) { measurables, constraints ->
        require(rules.gaps.size == measurables.size + 1) { "缝数必须是子项数 + 1" }
        val placeables = measurables.map { it.measure(Constraints(maxWidth = constraints.maxWidth)) }
        val contentHeight = placeables.sumOf { it.height }
        val minimumsPx = rules.gaps.sumOf { it.minimum.roundToPx() }
        val height = constraints.constrainHeight(maxOf(constraints.minHeight, contentHeight + minimumsPx))
        val sizes = rules.gapSizes(height.toDp(), placeables.map { it.height.toDp() })
        layout(constraints.maxWidth, height) {
            var y = sizes[0].toPx()
            placeables.forEachIndexed { index, placeable ->
                placeable.placeRelative((constraints.maxWidth - placeable.width) / 2, y.roundToInt())
                y += placeable.height + sizes[index + 1].toPx()
            }
        }
    }
}
