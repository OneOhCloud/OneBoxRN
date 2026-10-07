package cloud.oneoh.oneboxn.ui

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Column
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.components.NavRow
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import com.microsoft.fluent.mobile.icons.R as FluentR

// 设置的二级页：设置首屏只摆常用的三组七行，普通用户用不到的入口收在这里，不在首屏平铺。
// 「顶栏 + 一张无组标题的导航卡」：顶栏已经说了这是哪一页，组标题会把同一句话说两遍。

/**
 * 诊断：出了问题去哪看。行序按普通用户最可能先找的那一项排：先看用了多少、再看此刻在跑什么、
 * 最后才是日志与配置原文。
 *
 * [usage] 由导航层给：本机用量读的是激活配置的账本，没有激活配置时这一行禁用（禁用而非隐藏：
 * 让用户看得见有这么个东西，而不是纳闷它去哪了），而「有没有激活配置」只有导航层知道。
 */
@Composable
fun DiagnosticsScreen(usage: RowInteraction, onBack: () -> Unit, open: (SettingsRoute) -> Unit) {
    NavCardPage(title = stringResource(R.string.settings_diagnostics), onBack = onBack) {
        // 折线上扬：「用量随时间」就是折线；与用量页空态同一颗——那两处是同一个语义。
        NavRow(
            label = stringResource(R.string.settings_usage),
            icon = FluentR.drawable.ic_fluent_data_trending_24_regular,
            interaction = usage,
        )
        NavRow(
            label = stringResource(R.string.settings_stats),
            icon = FluentR.drawable.ic_fluent_data_bar_vertical_24_regular,
            interaction = RowInteraction.Clickable { open(SettingsRoute.STATS) },
        )
        NavRow(
            label = stringResource(R.string.settings_logs),
            icon = FluentR.drawable.ic_fluent_text_align_left_24_regular,
            interaction = RowInteraction.Clickable { open(SettingsRoute.LOGS) },
        )
        NavRow(
            label = stringResource(R.string.settings_config),
            icon = FluentR.drawable.ic_fluent_document_text_24_regular,
            interaction = RowInteraction.Clickable { open(SettingsRoute.CONFIG) },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NavCardPage(title: String, onBack: () -> Unit, rows: @Composable () -> Unit) {
    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(title) },
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
            SettingsGroup(label = null, content = rows)
        }
    }
}
