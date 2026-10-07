package cloud.oneoh.oneboxn.ui

import android.os.Build
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.BuildConfig
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.Region
import cloud.oneoh.oneboxn.core.RoutingMode
import cloud.oneoh.oneboxn.ui.components.MenuRow
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.ui.components.SettingsIconFamily
import cloud.oneoh.oneboxn.ui.components.NavRow
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import cloud.oneoh.oneboxn.update.AppUpdater
import com.microsoft.fluent.mobile.icons.R as FluentR

// 设置页。
//
// **没有页面标题**：分组卡的语义已经自解释，再加一个「设置」大标题只是重复 dock 上那个标签。
// 本页是除首页与配置页之外全部功能的入口，但首屏只摆常用的：三组七行。行按「用户的心智动作」分组
// 而不是按实现模块：怎么走网（路由模式、区域、规则）/ 往深处去（工具、诊断、高级设置——各自收进
// 二级页）/ 关于（这是什么、谁做的）。测速、NAT、日志、统计这类普通用户用不到的入口不在首屏平铺。
// 整页单一滚动容器，版本页脚随内容滚动。
//
// 开发者页不作为可见行出现，由版本页脚 3 连点直达；引擎参数在高级设置页里、不在本页首屏
// ——两处都摆就是两个入口。

/** 顶部 16、底部留白（dock 高由外层 Scaffold 垫付，这里只出那个 12）；卡间距走 `Theme.Spacing.cardGap`。 */
private val CONTENT_TOP_PADDING = 16.dp
private val CONTENT_BOTTOM_PADDING = 12.dp

/**
 * [open] 推入设置栈的下一层：本页与关于弹层的每个入口都经它，路由表只在导航层。
 * 本页不放任何更新入口：更新只在关于弹层的版本行上，不占用设置首屏的注意力。
 */
@Composable
fun SettingsScreen(updater: AppUpdater, open: (SettingsRoute) -> Unit) {
    val vm: SettingsViewModel = viewModel {
        // 版本/构建号取自包信息（iOS 对等 Info.plist；缺失即崩溃暴露，fail-fast）；
        // 引擎版本经 App 装配的唯一读取口；UA 与导入下载同源；外链 URL 经 BuildConfig 注入。
        val application = app
        val info = application.packageManager.getPackageInfo(application.packageName, 0)
        val versionName = requireNotNull(info.versionName) { "versionName missing from package info" }
        SettingsViewModel(
            actions = application.actions,
            versionName = versionName,
            engineVersion = application.engineVersion,
            buildNumber = info.longVersionCode.toString(),
            userAgent = application.userAgent(),
            websiteUrl = BuildConfig.WEBSITE_URL,
            privacyUrl = BuildConfig.PRIVACY_URL,
            operatingSystem = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
        )
    }
    val context = LocalContext.current

    // 领域错误：无法打开外链 → 提示并留在设置页（边界类型化）。
    var failedLink by remember { mutableStateOf<String?>(null) }
    var showAbout by remember { mutableStateOf(false) }
    val openLink: (String) -> Unit = { url ->
        if (!openExternalLink(context, url)) failedLink = url
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .screenBackground()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .readableContentWidth()
            .padding(horizontal = Theme.Spacing.lg)
            .padding(top = CONTENT_TOP_PADDING, bottom = CONTENT_BOTTOM_PADDING),
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.cardGap),
    ) {
        PreferencesGroup(vm, onOpenRules = { open(SettingsRoute.RULES) })
        DeeperGroup(vm, open)
        AboutGroup(onOpenAbout = { showAbout = true })
        VersionFooter(vm, onOpenDev = { open(SettingsRoute.DEV) })
    }

    if (showAbout) {
        AboutSheet(
            vm = vm,
            updater = updater,
            onOpenEngineInfo = { open(SettingsRoute.ENGINE_INFO) },
            onOpenRecords = { open(SettingsRoute.REFRESH_RECORDS) },
            onOpenLink = openLink,
            onDismiss = { showAbout = false },
        )
    }

    if (failedLink != null) {
        LinkOpenFailedDialog(onDismiss = { failedLink = null })
    }
}

/**
 * 偏好组：我要怎么走网。
 *
 * **路由模式与区域必须同处一组**（两个可变值行同组），故区域不放进关于组。
 * 隧道状态与直连 DNS 两条展示行归关于弹层的「系统信息」卡，不在本页首屏。
 */
@Composable
private fun PreferencesGroup(vm: SettingsViewModel, onOpenRules: () -> Unit) {
    SettingsGroup(label = null) {
        // 路由模式（值行菜单）。切换 = 立即持久化 + 已连接时热重载。
        MenuRow(
            label = stringResource(R.string.settings_routing_mode_label),
            icon = FluentR.drawable.ic_fluent_arrow_split_24_regular,
            iconFamily = SettingsIconFamily.Networking,
            options = listOf(
                Triple(RoutingMode.TUN_RULES, stringResource(R.string.settings_routing_mode_rules), true),
                Triple(RoutingMode.TUN_GLOBAL, stringResource(R.string.settings_routing_mode_global), true),
            ),
            selection = vm.routingMode,
            onSelect = vm::selectRoutingMode,
        )
        // 区域（值行菜单）。可选性取自 core Region.available（两端共读的唯一声明）。
        MenuRow(
            label = stringResource(R.string.settings_region_label),
            icon = FluentR.drawable.ic_fluent_globe_24_regular,
            iconFamily = SettingsIconFamily.Networking,
            options = Region.entries.map { Triple(it, stringResource(regionLabel(it)), it.available) },
            selection = vm.region,
            onSelect = vm::selectRegion,
        )
        NavRow(
            label = stringResource(R.string.settings_rules),
            icon = FluentR.drawable.ic_fluent_text_bullet_list_square_24_regular,
            interaction = RowInteraction.Clickable(onOpenRules),
        )
    }
}

/** 往深处去：两个二级入口——诊断（出问题去哪看）、高级设置（我知道自己在做什么）。 */
@Composable
private fun DeeperGroup(vm: SettingsViewModel, open: (SettingsRoute) -> Unit) {
    SettingsGroup(label = null) {
        NavRow(
            label = stringResource(R.string.settings_diagnostics),
            icon = FluentR.drawable.ic_fluent_stethoscope_24_regular,
            interaction = RowInteraction.Clickable { open(SettingsRoute.DIAGNOSTICS) },
        )
        // 不用齿轮一族（与 dock 的「设置」齿轮撞）：
        // 高级设置页里收的是几个开关与参数，开关形直白（对齐 iOS switch.2）。
        NavRow(
            label = stringResource(R.string.settings_advanced_label),
            icon = FluentR.drawable.ic_fluent_toggle_multiple_24_regular,
            interaction = RowInteraction.Clickable { open(SettingsRoute.ADVANCED) },
        )
    }
}

/** 关于组：这是什么、谁做的。只有一行——区域归偏好组，不留在这里。 */
@Composable
private fun AboutGroup(onOpenAbout: () -> Unit) {
    SettingsGroup(label = null) {
        NavRow(
            label = stringResource(R.string.settings_about),
            icon = FluentR.drawable.ic_fluent_info_24_regular,
            interaction = RowInteraction.Clickable(onOpenAbout),
        )
    }
}

private fun regionLabel(region: Region): Int = when (region) {
    Region.CN -> R.string.settings_region_cn
    Region.IR -> R.string.settings_region_ir
    Region.RU -> R.string.settings_region_ru
}

// —— 版本页脚：滚动内容末项；长按切 build 号 ——

@Composable
private fun VersionFooter(vm: SettingsViewModel, onOpenDev: () -> Unit) {
    val text = if (vm.showBuildNumber) {
        stringResource(R.string.settings_version_build, vm.versionLabel, vm.buildNumber)
    } else {
        stringResource(R.string.settings_version, vm.versionLabel)
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .pointerInput(Unit) {
                // 连点进开发者页与长按切 build 号并存，互不吞没。
                // 解锁静默无触感——触感词表只有五种语义，隐藏手势不在其内，不为它扩词表。
                detectTapGestures(
                    onTap = { if (vm.tapVersion()) onOpenDev() },
                    onLongPress = { vm.toggleBuildNumber() },
                )
            },
    ) {
        Text(
            text = text,
            style = Theme.Type.meta.tabular(),
            color = Theme.colors.textSecondary,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

