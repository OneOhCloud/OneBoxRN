package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import kotlinx.coroutines.launch

// 帮助弹层（规则、测速、NAT 类型三屏）。
//
// 三屏的帮助弹层**逐项同构**——同一种控件、同一种块，用户在几处看到的是同一个东西，
// 故三屏共用这一份；差的只有标题与说明块的内容。
//
// **面板取 `Radius.panel`（18）而不是 `card`（14）**：内部嵌了带底色的圆角块，
// 于是同心式「内层 = 外层 − 内衬」生效，家族里唯一成立的一组是内衬 `6` + 内层 `control`（12）。
// 底色用 `background` 而不是 `surface`，好让内部那些 `surface` 块有对比浮出来。

/** 一个说明块：标题 + 正文。 */
@Immutable
data class HelpBlock(val title: String, val body: String)



@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpSheet(title: String, blocks: List<HelpBlock>, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        // 弹层也是内容区：`ModalBottomSheet` 的 M3 默认上限 `640` 比内容区上限 `600` 宽，
        // 不给它，宽屏上弹层比页面还宽。
        sheetMaxWidth = Theme.maxReadableWidth,
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SheetPanel.GroupedCards.color(),
        shape = RoundedCornerShape(topStart = Theme.Radius.panel, topEnd = Theme.Radius.panel),
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Theme.sheetInset)
                // 内容比面板高时面板内滚动，底部留呼吸量，主按钮不贴下沿。
                .padding(bottom = Theme.sheetBottomInset),
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.lg),
        ) {
            // 标题条不画下边线：它与下面的块之间靠间距分开。
            Text(
                text = title,
                style = Theme.Type.sheetTitle,
                color = Theme.colors.textPrimary,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Theme.Spacing.textInset)
                    .padding(top = Theme.Spacing.lg),
            )
            for (block in blocks) {
                HelpBlockView(block)
            }
            // 只有一个动作时不摆两颗并排按钮凑对称，单颗居中。
            PrimaryButton(
                label = stringResource(R.string.failure_dismiss),
                onClick = { scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() } },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }
}

@Composable
private fun HelpBlockView(block: HelpBlock) {
    Column(
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
        horizontalAlignment = Alignment.Start,
        modifier = Modifier
            .fillMaxWidth()
            .background(Theme.colors.surface, RoundedCornerShape(Theme.Radius.control))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(
            text = block.title,
            // 说明块标题 `13/600`。同 `AboutSheet` 那一处：**不借 `sheetTitle` 的字重** ——
            // 块标题与弹层标题是两档。
            style = Theme.Type.status.copy(fontWeight = FontWeight.SemiBold),
            color = Theme.colors.textPrimary,
        )
        Text(
            text = block.body,
            style = Theme.Type.subtitle,
            color = Theme.colors.textSecondary,
        )
    }
}
