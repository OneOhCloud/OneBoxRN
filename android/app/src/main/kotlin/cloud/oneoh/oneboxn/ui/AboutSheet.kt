package cloud.oneoh.oneboxn.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.update.AppUpdater
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.components.RowInteraction
import cloud.oneoh.oneboxn.ui.components.SheetPanel
import cloud.oneoh.oneboxn.ui.components.color
import cloud.oneoh.oneboxn.ui.components.LinkRow
import cloud.oneoh.oneboxn.ui.components.NavRow
import cloud.oneoh.oneboxn.ui.components.NavValue
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import cloud.oneoh.oneboxn.ui.components.SettingsRow
import cloud.oneoh.oneboxn.ui.components.SheetTitleBar
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.launch

// 关于弹层。
//
// 「系统信息」卡（隧道状态胶囊 / 直连 DNS / UA + 复制键）不得省略——删掉等于静默撤掉三项既有行为。
//
// 底色用 `background` 而不是 `surface`：这样内部的两张分组卡才有对比浮得出来。

private val APP_LOGO_SIDE = 72.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutSheet(
    vm: SettingsViewModel,
    updater: AppUpdater,
    onOpenEngineInfo: () -> Unit,
    onOpenRecords: () -> Unit,
    onOpenLink: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    // 内容高过半屏时不该停在半屏档（与另外三个编辑弹层同一取向）。
    // 高度上限由 M3 弹层自己表达（它本就让开状态栏），不再自算一份——两份上限迟早会分叉。
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    fun dismissThen(action: () -> Unit) {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            onDismiss()
            action()
        }
    }

    ModalBottomSheet(
        // 弹层也是内容区：`ModalBottomSheet` 的 M3 默认上限 `640` 比内容区上限 `600` 宽，
        // 不给它，宽屏上弹层比页面还宽。
        sheetMaxWidth = Theme.maxReadableWidth,
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SheetPanel.GroupedCards.color(),
        shape = RoundedCornerShape(topStart = Theme.Radius.panel, topEnd = Theme.Radius.panel),
        // 标题条自带关闭键，再摆一根横杆就是同一个动作的第二个控件。
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Theme.Spacing.lg)
                .padding(bottom = Theme.sheetBottomInset),
            // 区段之间 `20`，与 Apple 同值。
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.cardGap),
        ) {
            SheetTitleBar(title = stringResource(R.string.settings_about), onClose = onDismiss)
            AppHero(vm)
            AboutUpdateCard(updater)
            SystemInfoCard(vm, onOpenEngineInfo = { dismissThen(onOpenEngineInfo) })
            LegalCard(vm, onOpenLink)
            SettingsGroup(label = null) {
                // 更新记录是导航行、不是只读事实行，故带图标（信息 / 导航族）。
                NavRow(
                    label = stringResource(R.string.dev_records_label),
                    // 回拨时钟，与开发者页那个入口、更新记录页空态同一颗（`text_align_left` 是「日志」那一颗）。
                    icon = FluentR.drawable.ic_fluent_history_24_regular,
                    interaction = RowInteraction.Clickable { dismissThen(onOpenRecords) },
                )
            }
        }
    }
}

@Composable
private fun AppHero(vm: SettingsViewModel) {
    // 纵向节奏「logo → 名 `12`，名 → 版本 `4`」：名与版本是一组，这一组再与 logo 分开。
    // 故写成两层 `Column`（外层隔开 logo 与「名 + 版本」，内层收拢名与版本）：均匀的 `spacedBy`
    // 只会画成等距，散落的 `Spacer` 在结构上读不出「这两样是一组」。iOS 侧同形。
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
    ) {
        // 应用 logo（由 assets/logo/icon.png 派生，与 Apple 的 app_logo 同源）；下方紧跟应用名，读屏不再念它。
        Image(
            painter = painterResource(R.drawable.ic_brand_logo),
            contentDescription = null,
            modifier = Modifier
                .size(APP_LOGO_SIDE)
                .clip(RoundedCornerShape(Theme.Radius.panel)),
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.xs),
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = Theme.Type.pageTitle,
                color = Theme.colors.textPrimary,
            )
            Text(
                text = stringResource(R.string.settings_version_build, vm.versionLabel, vm.buildNumber),
                style = Theme.Type.status.tabular(),
                color = Theme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * 系统信息卡。各行取值与判据全在 SettingsViewModel，本层不做判定。
 *
 * 本卡五行一律不带图标列，与 Apple 一致（只读事实行没有图标列）。
 */
@Composable
private fun SystemInfoCard(vm: SettingsViewModel, onOpenEngineInfo: () -> Unit) {
    // 五处都显式写 `icon = null` 而不是靠默认值：`icon` 是必填参数，让「忘了给」与「有意不给」分开。
    SettingsGroup(label = stringResource(R.string.settings_system_info)) {
        // 展示态胶囊随隧道连接状态，本行无交互。
        SettingsRow(label = stringResource(R.string.settings_tunnel), icon = null) {
            TunnelCapsule(state = if (vm.connected) TunnelState.RUNNING else TunnelState.STOPPED)
        }
        // DNS 展示态（取值见 SettingsViewModel）；无激活 → 占位。
        SettingsRow(label = stringResource(R.string.settings_dns), icon = null) {
            MonospaceValue(vm.dnsServer ?: VALUE_PLACEHOLDER)
        }
        SettingsRow(label = stringResource(R.string.settings_os_label), icon = null) {
            MonospaceValue(vm.operatingSystem)
        }
        // **五行里唯一的导航行**：行上这个版本串只是引擎自陈的第一个字段，
        // 子层（EngineInfoScreen）给的是整张表——`revision` 是 40 字符全长 sha（行上那个只是短前缀，
        // 核对产物同源要用全长的）、`target` / `build` 回答「哪个架构、Release 还是 Debug」、
        // `rustc` / `aws-lc` 是排 TLS 类问题要先看的依赖版本。
        // 故这一跳换的是问题本身：行答「哪一版」，子层答「到底是哪一个二进制」。
        // 九项里有等宽长串，塞回行内必被截断——这也是它不能退化成展示行的原因。
        NavRow(
            label = stringResource(R.string.dev_engine_label),
            icon = null,
            value = NavValue.Technical(vm.engineVersion),
            interaction = RowInteraction.Clickable(onOpenEngineInfo),
        )
        UserAgentRow(vm)
    }
}

@Composable
private fun LegalCard(vm: SettingsViewModel, onOpenLink: (String) -> Unit) {
    SettingsGroup(label = stringResource(R.string.settings_legal_info)) {
        LinkRow(
            label = stringResource(R.string.settings_website),
            icon = FluentR.drawable.ic_fluent_globe_24_regular,
            onClick = { onOpenLink(vm.websiteUrl) },
        )
        LinkRow(
            label = stringResource(R.string.settings_privacy),
            icon = FluentR.drawable.ic_fluent_hand_right_24_regular,
            onClick = { onOpenLink(vm.privacyUrl) },
        )
    }
}

/** UA 完整串（副标题呈现）+ 复制键（完整串入剪贴板 + 轻触感 + 短暂已复制反馈）。 */
@Composable
private fun UserAgentRow(vm: SettingsViewModel) {
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val copied = vm.uaCopied
    SettingsRow(
        label = stringResource(R.string.settings_ua),
        icon = null,
        technicalCaption = vm.userAgent,
    ) {
        IconButton(onClick = {
            scope.launch {
                // 写失败不报「已复制」（与 iOS `Clipboard.write` 的 guard 同契约）。
                if (clipboard.writeText("user-agent", vm.userAgent)) vm.markUaCopied()
            }
            // 复制 = light。触感无条件给：它是「点按已被接收」的回执，
            // 与「已在剪贴板」是两种信号。
            haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
        }) {
            Icon(
                painter = painterResource(
                    if (copied) FluentR.drawable.ic_fluent_checkmark_24_regular else FluentR.drawable.ic_fluent_copy_24_regular,
                ),
                contentDescription = stringResource(if (copied) R.string.copied else R.string.copy),
                tint = if (copied) Theme.tones.success.fg else Theme.colors.accent,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** 右侧的等宽技术值（DNS / 操作系统两行）。 */
@Composable
private fun MonospaceValue(text: String) {
    Text(
        text = text,
        // 技术值的字阶取行骨架**第二行**（副标题 `12`），**等宽是它唯一的自有属性**。
        // 同卡 UA 那一行的 `technicalCaption` 也是这一档 ⇒ 四个技术值同源。
        style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
        color = Theme.colors.textSecondary,
    )
}

/**
 * 隧道此刻的展示态。**用枚举而不是布尔**：调用点写 `TunnelState.RUNNING` 读得出是哪一态，
 * 写 `running = true` 只读得出某个开关是真。
 */
private enum class TunnelState { RUNNING, STOPPED }

/** 隧道状态胶囊：圆点 + 文字双信号（不只靠颜色）。 */
@Composable
private fun TunnelCapsule(state: TunnelState) {
    val running = state == TunnelState.RUNNING
    val container by animateColorAsState(
        targetValue = if (running) Theme.tones.success.container else Theme.colors.fill,
        animationSpec = stateTransitionSpec(),
        label = "tunnelContainer",
    )
    val content by animateColorAsState(
        targetValue = if (running) Theme.tones.success.fg else Theme.colors.textSecondary,
        animationSpec = stateTransitionSpec(),
        label = "tunnelContent",
    )
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .background(container, Theme.Radius.pill)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        // 圆点：运行中**实心** / 未连接**空心**。不用「同一个实心点降透明」，两条理由各自成立：
        // ① 形状是这枚药丸的第二条通道。降透明之后两态在灰度下同形，双信号塌回一条。
        // ② `0.4` 把圆点压到 2.27:1（暗）/ 1.70:1（亮），低于非文本图形的 `3:1`；
        //    满不透明的 `content` 是 6.41:1 / 4.75:1，两态都过。
        Box(
            Modifier
                .size(6.dp)
                .then(
                    if (running) {
                        Modifier.background(content, Theme.Radius.pill)
                    } else {
                        Modifier.border(1.dp, content, Theme.Radius.pill)
                    },
                ),
        )
        Text(
            text = stringResource(if (running) R.string.settings_running else R.string.settings_disconnected),
            // `13`：这枚药丸落在行骨架的右侧槽，与状态文案、分段控件、徽章同档。
            style = Theme.Type.status,
            color = content,
        )
    }
}

private const val VALUE_PLACEHOLDER = "—"
