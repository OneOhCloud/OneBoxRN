package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Composable
import cloud.oneoh.oneboxn.core.NodeLatency

// 节点延迟的三态：有测量值 / 测试窗口内无值 / 无数据。
// 三者都不靠纯颜色区分——数值、等待指示与「—」是三种不同的字形。
//
// **判定是纯逻辑，故不住在视图里**：「`delayMs > 0` 先于 testing」这条优先级要能被单测钉死
// （LatencyReadingTest）——测试窗口开着的同时引擎已经回了值，该显数值而不是转圈。

sealed interface LatencyReading {
    /** 引擎回了值：`delayMs > 0`，档位见 [tier]，语义色见 [tone]。 */
    data class Measured(val millis: Int) : LatencyReading

    /** 12 秒测试窗口内还没有值：显示等待指示。 */
    data object Testing : LatencyReading

    /** 没有数据也不在测试窗口内：显示「—」。 */
    data object Absent : LatencyReading
}

/**
 * 三态判定的唯一入口（视图只负责把结局画出来）。入参是延迟值而不是节点：
 * 会话卡读的是选中节点，而选中值可能暂时不在成员里（乐观选中、分组尚未推送），那时就是没有值。
 */
fun latencyReadingOf(delayMs: Int, latencyTesting: Boolean): LatencyReading = when {
    delayMs > 0 -> LatencyReading.Measured(delayMs)
    latencyTesting -> LatencyReading.Testing
    else -> LatencyReading.Absent
}

/** 档位只随数值走：没有数值的两态都落 `NONE`。 */
val LatencyReading.tier: NodeLatency.Tier
    get() = when (this) {
        is LatencyReading.Measured -> NodeLatency.tier(millis)
        LatencyReading.Testing, LatencyReading.Absent -> NodeLatency.Tier.NONE
    }

/** 档位 → 语义色对：阈值判定在 core `NodeLatency`，这里只做色映射。会话卡圆位与节点弹层行共用。 */
@Composable
fun NodeLatency.Tier.tone(): Tone = when (this) {
    NodeLatency.Tier.GOOD -> Theme.tones.success
    NodeLatency.Tier.FAIR -> Theme.tones.warning
    NodeLatency.Tier.POOR -> Theme.tones.error
    NodeLatency.Tier.NONE -> Tone(fg = Theme.colors.textSecondary, container = Theme.colors.fill)
}
