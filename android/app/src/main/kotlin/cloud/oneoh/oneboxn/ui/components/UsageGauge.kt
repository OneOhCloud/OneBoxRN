package cloud.oneoh.oneboxn.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Motion
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.motionSpec
import kotlin.math.min

// 用量条：高 6 的胶囊条——轨与填充**都是满圆角**。它是「还剩多少」的那一眼，细成一条线就读不出长短。
//
// 档位只有两档：正常 `accent` / 超额（已用 ≥ 总量）错误前景，没有警告档。
//
// 无配额（total ≤ 0）是合法业务态但不属本组件——消费方先按 hasQuota 分支；坏输入即崩溃（fail-fast）。
object UsageGauge {
    // 百分比唯一来源：文字百分比与着色共用。取整是截断（与 Apple 同口径）：
    // 四舍五入会让差一个字节没用满的配额读成 100%，而它还没用尽。
    fun percent(used: Long, total: Long): Int {
        require(total > 0) { "UsageGauge requires total > 0; gate on hasQuota first" }
        return (min(1.0, used.coerceAtLeast(0).toDouble() / total) * 100).toInt()
    }
}

@Composable
fun UsageGauge(
    usedBytes: Long,
    totalBytes: Long,
    modifier: Modifier = Modifier,
) {
    val percent = UsageGauge.percent(usedBytes, totalBytes)
    val fill = if (usedBytes >= totalBytes) Theme.tones.error.fg else Theme.colors.accent
    val fraction by animateFloatAsState(
        targetValue = percent / 100f,
        animationSpec = motionSpec(Motion.PROGRESS_MS),
        label = "usageGauge",
    )
    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(BAR_HEIGHT)
            .clip(Theme.Radius.pill)
            .background(Theme.colors.fill)
            // 名字答「这是什么」，值答「现在是哪个值」。
            // 塞进 contentDescription，这个元素的**名字**就成了「34%」——读屏念出一个数字
            // 而不说它是什么。Apple 那端用 .accessibilityValue，名字留给行本身。
            .semantics { stateDescription = "$percent%" },
    ) {
        // 填充最小宽度取条高（0% 仍看得见一粒圆头）。
        val fillWidth = maxOf(BAR_HEIGHT, maxWidth * fraction)
        Box(
            Modifier
                .width(fillWidth)
                .fillMaxHeight()
                .clip(Theme.Radius.pill)
                .background(fill),
        )
    }
}

private val BAR_HEIGHT = 6.dp
