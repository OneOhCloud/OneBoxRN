package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.UsageTier
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.ui.components.SegmentPicker
import cloud.oneoh.oneboxn.ui.components.UsageChartCard
import androidx.compose.ui.graphics.Color
import com.microsoft.fluent.mobile.icons.R as FluentR

// 本机用量页：单个配置的账本。
// 三档分段 + 卡片（汇总 + 柱图 + 刻度，共用件 UsageChartCard）；无记录走空态，不画一排 0 值柱。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageScreen(profileId: String, profileName: String, onBack: () -> Unit) {
    val vm: UsageViewModel = viewModel(key = "usage-$profileId") {
        UsageViewModel(app.actions, profileId)
    }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(profileName) },
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
        val empty = vm.loaded && !vm.hasRecord
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                // **空态那一支不挂滚动**：那时页面只有分段器与空态，没有溢出可滚；
                // 而 `verticalScroll` 把竖向约束放成无限，`EmptyState` 的 `fillMaxSize`
                // 于是塌成内容高——「在剩余视口里垂直居中」就等于没居中。
                // 共享件本身是对的，坑在承载它的容器。
                .then(if (empty) Modifier else Modifier.verticalScroll(rememberScrollState()))
                .readableContentWidth()
                .padding(horizontal = Theme.Spacing.lg)
                .padding(top = Theme.Spacing.lg, bottom = Theme.Spacing.md),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SegmentPickerRow(vm)
            if (empty) {
                EmptyState(
                    icon = painterResource(FluentR.drawable.ic_fluent_data_trending_24_regular),
                    title = stringResource(R.string.device_usage_empty),
                    caption = stringResource(R.string.device_usage_empty_note),
                    // 占满分段器之下的全部剩余高度，空态才有「剩余视口」可居中。
                    modifier = Modifier.weight(1f),
                )
                return@Column
            }
            UsageChartCard(vm.series, vm.tier)
            Text(
                text = stringResource(R.string.device_usage_scope_note),
                // 口径脚注（`11` `textSecondary`）取「说明脚注（散文）`400`」：它是两句完整的说明句子，
                // 不是某一行的从属元信息（那一类是 `meta` 的 `500`）。同为 `11`，角色不同，字重不同。
                style = Theme.Type.note,
                color = Theme.colors.textSecondary,
            )
        }
    }
}

@Composable
private fun SegmentPickerRow(vm: UsageViewModel) {
    SegmentPicker(
        options = listOf(
            UsageTier.TODAY to stringResource(R.string.device_usage_today),
            UsageTier.MONTH to stringResource(R.string.device_usage_month),
            UsageTier.HALF_YEAR to stringResource(R.string.device_usage_half_year),
        ),
        selection = vm.tier,
        onSelect = vm::select,
    )
}
