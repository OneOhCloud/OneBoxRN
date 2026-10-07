package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.Theme

/**
 * 区段小标题：`11` 大写、字距按 `Theme.Type.sectionLabel`，放在卡外上方而不是卡里。
 * 字距不在这里复述值，只按令牌引。
 */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        Text(
            text = title.uppercase(),
            style = Theme.Type.sectionLabel,
            color = Theme.colors.textSecondary,
            // 读屏有「按标题跳转」的转子/手势，没有这个语义的标题只是一个
            // 普通停留点，用户只能逐格扫过去。
            modifier = Modifier.semantics { heading() },
        )
    }
}
