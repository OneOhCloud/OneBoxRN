package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Node
import cloud.oneoh.oneboxn.ui.LatencyReading
import cloud.oneoh.oneboxn.ui.SecondaryTextSurface
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.latencyReadingOf
import cloud.oneoh.oneboxn.ui.nodeNameText
import cloud.oneoh.oneboxn.ui.tabular
import cloud.oneoh.oneboxn.ui.tier
import cloud.oneoh.oneboxn.ui.tone

// 节点选择弹层：出口选择组成员的平铺列表（不显示组名）+ 选中态 + 延迟读数。
// 延迟测试全自动，弹层里没有手动测速入口；testing 窗口内还没有值的节点显示等待指示。

/** 弹层要画的全部输入。 */
@Immutable
data class NodeChoices(
    val nodes: List<Node>,
    /** 自动组此刻解析到的节点，自动组那一行的显示名要带上它。 */
    val autoResolved: String,
    val selected: String,
    /** 测速窗口开着：还没有值的节点显示等待指示而不是「—」。 */
    val latencyTesting: Boolean,
)

@Composable
fun NodeSheet(
    choices: NodeChoices,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    SelectionSheet(
        title = stringResource(R.string.nodes_title),
        options = choices.nodes,
        optionKey = { it.tag },
        optionRow = { node ->
            SelectionRow(
                title = nodeNameText(node.tag, choices.autoResolved),
                subtitle = null,
                state = if (node.tag == choices.selected) MenuOptionState.Chosen else MenuOptionState.Plain,
                trailing = { surface ->
                    NodeLatencyReading(latencyReadingOf(node.delayMs, choices.latencyTesting), surface)
                },
            )
        },
        onSelect = { node -> onSelect(node.tag) },
        onDismiss = onDismiss,
    )
}

/**
 * 延迟三态的呈现（判定在 [latencyReadingOf]，本处只负责把结局画出来）。
 *
 * [surface] 是这一行此刻坐着的底。**选中行铺 `accentContainer`，而四支档位色压它全部不达标**
 * （`success.fg` `4.25` · `warning.fg` `4.40` · `error.fg` `4.27` · `textSecondary` `4.30`，
 * 文字门槛 `4.5`）⇒ 那一行的读数走 `textPrimary`（`13.39`）。
 *
 * **档位色是冗余编码，不是唯一载体** —— 这一格画的是 `nodes_delay`，**毫秒数就是文字本身**，
 * 退掉颜色一个信息都不丢（顺带更合 WCAG 1.4.1：颜色不得是唯一手段）。
 * **未选中行一个字不动**：它们不坐在 `accentContainer` 上，四支读数在面板上都达标。
 */
@Composable
private fun NodeLatencyReading(reading: LatencyReading, surface: SecondaryTextSurface) {
    when (reading) {
        is LatencyReading.Measured -> Text(
            text = stringResource(R.string.nodes_delay, reading.millis),
            style = Theme.Type.meta.tabular(),
            color = when (surface) {
                SecondaryTextSurface.AccentContainer -> Theme.colors.textPrimary
                SecondaryTextSurface.Plain -> reading.tier.tone().fg
            },
        )
        LatencyReading.Testing -> CircularProgressIndicator(
            modifier = Modifier.size(14.dp),
            strokeWidth = 2.dp,
        )
        LatencyReading.Absent -> Text(
            text = LATENCY_PLACEHOLDER,
            style = Theme.Type.meta.tabular(),
            // 占位符同样随底升档（`Theme.secondaryText`，四处同源）。
            color = Theme.secondaryText(on = surface, colors = Theme.colors),
        )
    }
}

private const val LATENCY_PLACEHOLDER = "—"
