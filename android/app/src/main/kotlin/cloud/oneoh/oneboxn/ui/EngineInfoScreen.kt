package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import cloud.oneoh.oneboxn.ui.components.preferenceRowPadding
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import com.microsoft.fluent.mobile.icons.R as FluentR

// 关于内核：引擎名与版本两行固定，
// 其余是引擎自陈的有序键值对——键是英文 token，原样呈现不翻译（与日志行同类）。
// Android 走构建期烘焙常量，UI 进程零 FFI、不加载引擎 .so。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EngineInfoScreen(onBack: () -> Unit) {
    val vm: EngineInfoViewModel = viewModel { EngineInfoViewModel(app.engineInfo) }
    val info = vm.info

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.dev_engine_info_title)) },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .readableContentWidth()
                .padding(horizontal = Theme.Spacing.lg)
                .padding(top = Theme.Spacing.lg, bottom = Theme.Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.lg),
        ) {
            // 固定两行 + 引擎自陈的有序键值对**同处一张卡**：
            // 分两张卡会读成「这两行和下面那些不是一类东西」，而它们是同一份自陈。
            SettingsGroup(label = null) {
                InfoRow(label = "engine", value = info.name)
                InfoRow(label = "version", value = info.version)
                for (entry in info.entries) {
                    InfoRow(label = entry.key, value = entry.value)
                }
            }
        }
    }
}

/**
 * 键（`15`）左、值（等宽）右。
 *
 * **值必须自己占一段可换行的宽度**：`revision` 是 40 字符的十六进制，用 `Spacer(weight)`
 * 顶开时它换行后会直接压到键上。两侧各自 `weight`、中间留 `12` 的间隔，长值在自己那一栏里换行。
 *
 * **两栏都要 `fill`**：键那栏若写成 `weight(1f, fill = false)`，它缩到内容宽，
 * 值那栏跟着整体左移——右对齐的值因此逐行停在不同的 x 上。
 */
@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().preferenceRowPadding(),
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
    ) {
        // 键 `15` textSecondary，值 `11` 等宽：两者一样大会让「哪一栏是键、哪一栏是值」
        // 失去字阶通道，只剩对齐方向在区分。
        Text(
            text = label,
            style = Theme.Type.rowTitle,
            color = Theme.colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = Theme.Type.meta,
            fontFamily = FontFamily.Monospace,
            color = Theme.colors.textPrimary,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(2f),
        )
    }
}
