package cloud.oneoh.oneboxn.ui

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.BackgroundRunPermission
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.components.NavRow
import cloud.oneoh.oneboxn.ui.components.NavValue
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import cloud.oneoh.oneboxn.ui.components.SettingsRow
import androidx.compose.ui.graphics.Color
import com.microsoft.fluent.mobile.icons.R as FluentR

// 高级设置页：收「改的是平台运行方式、而非产品行为」的那一类设置。
// Android 只有电池优化一行——按需连接与网络包含范围是 iOS 专属。
// 本页无版本页脚：页脚是设置页首屏的收尾件，复制一份到子页会让连点入口出现两个宿主。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdvancedSettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    // 豁免与否是系统权限状态，本页不持有——进页时读一次，从系统电池优化页返回时重读。
    var backgroundRunAllowed by remember { mutableStateOf(BackgroundRunPermission.isAllowed(context)) }
    val backgroundPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        backgroundRunAllowed = BackgroundRunPermission.isAllowed(context)
    }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_advanced_label)) },
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
        ) {
            // 无 caption：顶栏已经是「高级设置」，组标题会把同一句话说两遍；仓内单组子页
            // （如引擎信息页）本就是这个形。
            SettingsGroup(label = null) {
                BatteryOptimizationRow(
                    value = stringResource(
                        if (backgroundRunAllowed) {
                            R.string.settings_background_run_allowed
                        } else {
                            R.string.settings_background_run_not_allowed
                        },
                    ),
                    onClick = {
                        if (backgroundRunAllowed) return@BatteryOptimizationRow
                        try {
                            backgroundPermissionLauncher.launch(BackgroundRunPermission.requestIntent(context))
                        } catch (_: ActivityNotFoundException) {
                            backgroundRunAllowed = BackgroundRunPermission.isAllowed(context)
                        }
                    },
                )
            }
        }
    }
}

// 电池优化行（值 + 外跳动作）：点按去的是**系统设置页**，故右侧图标取外链那一档 `arrow_up_right`
// （右侧图标三分语义：推入 chevron_right、外跳 arrow_up_right、就地展开 chevron_up_down）。
//
// **标签与图标写在里面，不开成参数**：本页的「值 + 外跳」只有这一行——只有一个调用点的「通用件」，
// 它的参数表是在为不存在的第二个调用点付账。与 `LinkRow` 把族写死是同一条判法：
// **它是这个行别的属性，不是调用点的选择。**
//
// **骨架走共享件 `SettingsRow`，不自绘**（多处同形即须同源）：按压反馈（整行填充）、右侧图标 `13`、
// 值与右侧图标的间距因此与同页 `NavRow` 逐字相同，同页两行的值文本停在同一个 x 上。
//
// **值不带权重，与同页 `NavRow` 逐字相同** —— 不照 `MenuRow`（值 `weight(1f)` + 右对齐）：
// 两个带权重的子项对半分，默认字号下「Battery Optimization」就会被截断。
// `MenuRow` 那条是为**大字号下值把标签挤没**立的，它的值是用户选出来的选项串；
// 本行的值是两个定长状态词（已豁免 / 未豁免），够不成那个威胁，而它的标签是全页最长的一个。
// 值不带权重即可：它先量、只占内容宽，右缘与 `NavRow` 落在同一 x，标签拿走其余。
//
// **族取默认的 `Informational`（accent）**：参考实现的第三族（电源 / 启动 / 自动连接）语义上罩得住
// 「电池优化」，但 `SettingsIconFamily` 是两端同名同 case 集的跨端契约，而本行是 Android 专属——
// 为它开一档，另一端会得到一个零消费方的 case。任意端出现第二处同语义的行时再一次开档、两处一起接上。
@Composable
private fun BatteryOptimizationRow(value: String, onClick: () -> Unit) {
    SettingsRow(
        label = stringResource(R.string.settings_background_run_label),
        interaction = RowInteraction.Clickable(onClick),
        // 电池：这一行去的是系统电池优化豁免页，取语义最直白的那一个
        // （`power` 已是「连接开关」、闪电读作充电）。
        icon = FluentR.drawable.ic_fluent_battery_saver_24_regular,
    ) {
        Text(
            // 值取 `13`（行骨架右侧 badge 那一档），与共享件 `NavValue.Preference` 同档。
            text = value,
            style = Theme.Type.status,
            color = Theme.colors.textSecondary,
        )
        Spacer(Modifier.width(6.dp))
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_arrow_up_right_24_regular),
            contentDescription = null,
            tint = Theme.colors.textSecondary,
            modifier = Modifier.size(Theme.RowMetrics.trailingIconSize),
        )
    }
}
