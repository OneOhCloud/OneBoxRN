package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.ui.components.NavRow
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import cloud.oneoh.oneboxn.ui.components.preferenceRowPadding
import androidx.compose.ui.text.style.TextOverflow
import cloud.oneoh.oneboxn.ui.components.SettingsIconColumn
import cloud.oneoh.oneboxn.ui.components.ToggleItem
import cloud.oneoh.oneboxn.ui.components.ToggleRow
import androidx.compose.ui.graphics.Color
import com.microsoft.fluent.mobile.icons.R as FluentR

// 开发者页：两个诊断开关 + 两个入口。
// 版式照设置页语法（SettingsGroup + 开关行 / 导航行），不自由发挥。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevScreen(onBack: () -> Unit, onOpenRecords: () -> Unit, onOpenEngineInfo: () -> Unit) {
    val vm: DevViewModel = viewModel { DevViewModel(app.actions) }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.dev_title)) },
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
                .padding(horizontal = Theme.Spacing.lg, vertical = 8.dp),
            // 本列四个子项全是分组卡 ⇒ 三处间隔都是「卡→卡」，整列一个值就够。
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.cardGap),
        ) {
            SettingsGroup(label = stringResource(R.string.dev_fetch_label)) {
                ToggleRow(
                    item = ToggleItem(
                        label = stringResource(R.string.dev_force_fallback_label),
                        // 回落 = 抓取折回另一条地址 ⇒ 掉头箭头（对齐 iOS arrow.uturn.down）。
                        icon = FluentR.drawable.ic_fluent_arrow_hook_down_left_24_regular,
                        isOn = vm.forceFallbackEnabled,
                        subtitle = stringResource(R.string.dev_force_fallback_caption),
                    ),
                    onToggle = vm::setForceFallback,
                )
            }

            // 开关与入口拆成同组两行：一行不能既是 Switch 又带 chevron.right，
            // 那会打破右侧图标三分语义（Switch / chevron / 无）。
            SettingsGroup(label = stringResource(R.string.dev_update_label)) {
                ToggleRow(
                    item = ToggleItem(
                        label = stringResource(R.string.dev_background_refresh_label),
                        // 虚线的顺时针箭头：与配置行菜单「刷新」、配置页「更新全部」那枚实线箭头同族——
                        // 同一个动作，本行只是把它交给系统定时去做；虚线把「自动」与「手动那一下」分开。
                        icon = FluentR.drawable.ic_fluent_arrow_clockwise_dashes_24_regular,
                        isOn = vm.backgroundRefreshEnabled,
                        subtitle = stringResource(R.string.dev_background_refresh_caption),
                    ),
                    onToggle = vm::setBackgroundRefresh,
                )
                // 回拨时钟 = 记录（过去发生过的那些次），**不是 `arrow_clockwise`**：
                // 那一颗是更新这个动作，而本行是它的历史。
                NavRow(
                    label = stringResource(R.string.dev_records_label),
                    icon = FluentR.drawable.ic_fluent_history_24_regular,
                    interaction = RowInteraction.Clickable(onOpenRecords),
                )
            }

            SettingsGroup(label = stringResource(R.string.dev_engine_label)) {
                // 芯片 = 引擎（对齐 iOS cpu）：本行是引擎的自陈。
                NavRow(
                    label = stringResource(R.string.dev_engine_info_label),
                    icon = FluentR.drawable.ic_fluent_developer_board_24_regular,
                    interaction = RowInteraction.Clickable(onOpenEngineInfo),
                )
            }
            // 观察通道还活着吗：通道定格时统计页照常画旧数字、日志页停在最后一行、连接态显示已连接，
            // 应用内只有这一组能回答这个问题，否则只能靠系统日志倒推。
            SettingsGroup(label = stringResource(R.string.dev_observation_label)) {
                // 端点 = 通道插在哪里 ⇒ 插头；距最近一帧 = 时钟；重建 = 拆掉又建起来 ⇒ 双向循环箭头
                // （对齐 iOS arrow.triangle.2.circlepath）。回拨时钟与单向刷新箭头已是「更新记录」与「更新」。
                ValueRow(
                    stringResource(R.string.dev_observation_endpoint),
                    vm.observationEndpoint,
                    FluentR.drawable.ic_fluent_plug_connected_24_regular,
                )
                ValueRow(
                    stringResource(R.string.dev_observation_last_frame),
                    vm.observationLastFrame,
                    FluentR.drawable.ic_fluent_clock_24_regular,
                )
                ValueRow(
                    stringResource(R.string.dev_observation_rebuilds),
                    vm.observationRebuilds,
                    FluentR.drawable.ic_fluent_arrow_sync_24_regular,
                )
            }
        }
    }
}

// 只读值行：无右侧图标，与开关行/导航行共存不破坏右侧图标三分语义
// （三分说的是「Switch / chevron / 无」，无图标那一档正是纯展示）。
// 前导图标列照设置页行骨架保留（`28` 图标列）；关于弹层事实行不带图标列只限那一屏。
@Composable
private fun ValueRow(label: String, value: String, icon: Int) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .preferenceRowPadding(),
    ) {
        SettingsIconColumn(icon = icon)
        Text(
            text = label,
            style = Theme.Type.rowTitle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = Theme.Type.meta.tabular(),
            color = Theme.colors.textSecondary,
        )
    }
}
