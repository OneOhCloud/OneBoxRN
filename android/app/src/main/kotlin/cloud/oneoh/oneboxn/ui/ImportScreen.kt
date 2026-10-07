package cloud.oneoh.oneboxn.ui

import android.app.Activity
import android.net.VpnService
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.BuildConfig
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.ImportConclusion
import cloud.oneoh.oneboxn.core.ImportError
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.ImportedProfile
import cloud.oneoh.oneboxn.core.UrlInfo
import cloud.oneoh.oneboxn.ui.components.ButtonRow
import cloud.oneoh.oneboxn.ui.components.OrbSize
import cloud.oneoh.oneboxn.ui.components.PrimaryButton
import cloud.oneoh.oneboxn.ui.components.ProfileSummaryCard
import cloud.oneoh.oneboxn.ui.components.SecondaryButton
import cloud.oneoh.oneboxn.ui.components.StatusOrb
import cloud.oneoh.oneboxn.ui.components.SummaryCardBody
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.flow.drop

// 导入流程页：相位由 core ImportFlow 经 ImportViewModel 驱动。进行中、成功、失败三态同一副骨架——
// 页顶一枚圆盘 + 结论 + 一句说明，下面一块主体，再下面是去处；整组贴顶排，余量归页底。
// Applied（deep-link 自动应用）自动回来处。

/** 导入页的去处，由宿主按各自的栈与 tab 给出。 */
@Immutable
data class ImportExits(
    /** 「完成」与自动应用落定：清掉本 tab 的导入栈，回到来处的根页。 */
    val done: () -> Unit,
    /** 顶栏返回与失败页的「返回」：退一层。 */
    val back: () -> Unit,
    /** 「连接」「立即使用」发起之后：清掉导入栈并回首页 tab，结局在电源砖上看。 */
    val showHome: () -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(
    actions: AppActions,
    payload: ImportPayload,
    viewModelStoreOwner: ViewModelStoreOwner,
    exits: ImportExits,
) {
    val vm: ImportViewModel = viewModel(viewModelStoreOwner = viewModelStoreOwner) {
        ImportViewModel(actions, payload)
    }
    // 与首页电源砖同一个实例（Activity 作用域）：主按钮读砖此刻的动作，「连接」也走砖的那一次连接。
    val home: HomeViewModel = viewModel { HomeViewModel(actions) }
    val context = LocalContext.current
    val consentRequired = actions.requiresVpnConsent(payload)
    var consentGranted by rememberSaveable(payload.url) { mutableStateOf(!consentRequired) }
    var consentDenied by rememberSaveable(payload.url) { mutableStateOf(false) }
    var connectDenied by remember { mutableStateOf(false) }
    val consentLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            consentGranted = true
        } else {
            consentDenied = true
        }
    }
    // 「连接」与电源砖同一条授权链；授权被拒就停在本页，给出与首页同一句提示。
    val connect = connectAction(
        start = {
            home.connect()
            exits.showHome()
        },
        onPermissionDenied = { connectDenied = true },
    )

    // Android 首装自动应用必须先由 Activity 完成系统 VPN 授权；ViewModel 在授权前保持 IDLE。
    LaunchedEffect(consentRequired, payload.url) {
        if (!consentRequired || consentGranted || consentDenied) return@LaunchedEffect
        val consent = VpnService.prepare(context)
        if (consent == null) consentGranted = true else consentLauncher.launch(consent)
    }
    LaunchedEffect(vm, consentGranted) {
        if (consentGranted) vm.start()
    }

    // Applied 终态自动回来处（Success 停在结论页等用户选去处）。
    LaunchedEffect(vm.phase) {
        if (vm.phase == ImportViewModel.Phase.APPLIED) exits.done()
    }

    // 导入结局触感（success=Confirm / error=Reject）：drop(1) 跳过重组进入时的驻留态，只对迁移发触感。
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(vm) {
        snapshotFlow { vm.phase }
            .drop(1)
            .collect { phase ->
                when (phase) {
                    ImportViewModel.Phase.SUCCESS, ImportViewModel.Phase.APPLIED ->
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    ImportViewModel.Phase.ERROR_NETWORK,
                    ImportViewModel.Phase.ERROR_HTTP,
                    ImportViewModel.Phase.ERROR_CONTENT,
                    ImportViewModel.Phase.ERROR_START,
                    -> haptics.performHapticFeedback(HapticFeedbackType.Reject)
                    else -> {}
                }
            }
    }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.import_title)) },
                navigationIcon = {
                    IconButton(onClick = exits.back) {
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
        // 整组贴顶：按比例分余量会在高屏上方空出一大块，读起来像内容没加载完。
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .readableContentWidth()
                .padding(horizontal = Theme.Spacing.lg)
                .padding(top = Theme.Spacing.xl, bottom = Theme.Spacing.lg),
        ) {
            when (val page = importPage(vm, home, payload)) {
                is ImportPage.InProgress -> InProgressPage(page, host = UrlInfo.hostname(payload.url))
                is ImportPage.Succeeded -> SucceededPage(
                    page = page,
                    onPrimary = when (page.conclusion.primary) {
                        ImportConclusion.PrimaryAction.CONNECT -> connect
                        ImportConclusion.PrimaryAction.USE_NOW -> {
                            {
                                actions.useActiveProfile()
                                exits.showHome()
                            }
                        }
                    },
                    onDone = exits.done,
                )
                // 自动应用成功即离页，页头只在退场时一闪，不加后果句。
                ImportPage.Applied -> ResultHeader(
                    orb = OrbLook.Done,
                    title = stringResource(R.string.import_success),
                    note = null,
                )
                is ImportPage.Failed -> FailedPage(
                    page = page,
                    onPrimary = when (page.conclusion.actions) {
                        ImportConclusion.FailureActions.RETRY_OR_BACK -> vm::retry
                        ImportConclusion.FailureActions.BACK_ONLY -> exits.back
                    },
                    onSecondary = exits.back,
                )
            }
        }
    }

    if (consentDenied) {
        AlertDialog(
            onDismissRequest = exits.back,
            title = { Text(stringResource(R.string.home_vpn_permission_title)) },
            text = { Text(stringResource(R.string.home_vpn_permission_message)) },
            confirmButton = {
                TextButton(onClick = exits.back) { Text(stringResource(R.string.ok)) }
            },
        )
    }
    if (connectDenied) {
        // 「连接」的授权被拒：用户选择而非错误，留在结论页，配置已经存好。
        AlertDialog(
            onDismissRequest = { connectDenied = false },
            title = { Text(stringResource(R.string.home_vpn_permission_title)) },
            text = { Text(stringResource(R.string.home_vpn_permission_message)) },
            confirmButton = {
                TextButton(onClick = { connectDenied = false }) { Text(stringResource(R.string.ok)) }
            },
        )
    }
}

/** 这一刻页上画哪一态；成功与失败的判定（后果、主按钮、能否重试）在 core `ImportConclusion`。 */
private sealed interface ImportPage {
    data class InProgress(val steps: List<ImportProgressStep>) : ImportPage
    data class Succeeded(val imported: ImportedProfile, val conclusion: ImportConclusion.Succeeded) : ImportPage
    data object Applied : ImportPage
    data class Failed(val error: ImportError, val detail: String, val conclusion: ImportConclusion.Failed) : ImportPage
}

private fun importPage(vm: ImportViewModel, home: HomeViewModel, payload: ImportPayload): ImportPage = when (vm.phase) {
    ImportViewModel.Phase.IDLE,
    ImportViewModel.Phase.VERIFYING,
    ImportViewModel.Phase.STOPPING,
    ImportViewModel.Phase.DOWNLOADING,
    ImportViewModel.Phase.APPLYING,
    -> ImportPage.InProgress(importSteps(vm.phase, payload.requestedApply, vm.willApply))
    ImportViewModel.Phase.SUCCESS -> {
        val imported = checkNotNull(vm.imported) { "success phase without the stored profile" }
        ImportPage.Succeeded(
            imported = imported,
            // 主按钮与电源砖此刻的动作同一语义：砖要「断开」时（已连接 / 连接中）给「立即使用」。
            conclusion = ImportConclusion.of(imported.outcome, deriveHeroAction(home.heroState)) as ImportConclusion.Succeeded,
        )
    }
    ImportViewModel.Phase.APPLIED -> ImportPage.Applied
    ImportViewModel.Phase.ERROR_NETWORK,
    ImportViewModel.Phase.ERROR_HTTP,
    ImportViewModel.Phase.ERROR_CONTENT,
    ImportViewModel.Phase.ERROR_START,
    -> {
        val error = checkNotNull(vm.error) { "error phase without import error" }
        ImportPage.Failed(error, vm.errorDetail, ImportConclusion.of(error) as ImportConclusion.Failed)
    }
}

/** 进行中：结论位写「通过链接导入配置」，说明位只写主机名——整串链接常带访问令牌，也读不出这是哪一份。 */
@Composable
private fun InProgressPage(page: ImportPage.InProgress, host: String) {
    ResultHeader(
        orb = OrbLook.Running,
        title = stringResource(R.string.import_hint),
        note = host.takeIf { it.isNotEmpty() },
        noteFamily = FontFamily.Monospace,
    )
    Spacer(Modifier.height(HEADER_TO_BODY))
    Column(
        verticalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(Theme.Radius.panel)
            .padding(Theme.Spacing.lg),
    ) {
        for (step in page.steps) ImportProgressRow(step)
    }
}

/** 成功：结论与后果在上，下面是这一份的配置卡（与配置页同一张，不可点），再下面是两个去处。 */
@Composable
private fun SucceededPage(page: ImportPage.Succeeded, onPrimary: () -> Unit, onDone: () -> Unit) {
    val labels = importSuccessLabels(page.conclusion)
    ResultHeader(
        orb = OrbLook.Done,
        title = stringResource(labels.headline),
        note = stringResource(labels.consequence),
    )
    Spacer(Modifier.height(HEADER_TO_BODY))
    // 卡随结论一起到：从进行中切过来时淡入，不是凭空跳出一块。
    val appear = remember { MutableTransitionState(false).apply { targetState = true } }
    AnimatedVisibility(visibleState = appear, enter = fadeIn(motionSpec(Motion.PAGE_MS))) {
        ProfileSummaryCard(
            profile = page.imported.profile,
            productWebsite = BuildConfig.WEBSITE_URL,
            body = SummaryCardBody.Static,
        )
    }
    Spacer(Modifier.height(HEADER_TO_BODY))
    ButtonRow {
        SecondaryButton(label = stringResource(labels.secondary), onClick = onDone)
        PrimaryButton(label = stringResource(labels.primary), onClick = onPrimary)
    }
}

/** 失败：分类提示在结论下，原始诊断放进卡里的错误框；给不给「重试」由 core 判定。 */
@Composable
private fun FailedPage(page: ImportPage.Failed, onPrimary: () -> Unit, onSecondary: () -> Unit) {
    val labels = importFailureLabels(page.conclusion)
    ResultHeader(
        orb = OrbLook.Failed,
        title = stringResource(
            if (page.error is ImportError.StartFailed) R.string.import_start_failed else R.string.import_failed,
        ),
        note = importErrorHint(page.error),
    )
    Spacer(Modifier.height(HEADER_TO_BODY))
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(Theme.Radius.panel)
            .padding(Theme.Spacing.lg),
    ) {
        // 原始诊断可能很长（引擎诊断、网络栈异常），框内自己滚，不把按钮推出一屏。
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = DIAGNOSTIC_MAX_HEIGHT)
                .background(Theme.tones.error.container, RoundedCornerShape(Theme.Radius.control))
                .verticalScroll(rememberScrollState())
                .padding(Theme.Spacing.md),
        ) {
            Text(
                text = page.detail,
                style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                color = Theme.tones.error.fg,
            )
        }
    }
    Spacer(Modifier.height(HEADER_TO_BODY))
    ButtonRow {
        labels.secondary?.let { secondary ->
            SecondaryButton(label = stringResource(secondary), onClick = onSecondary)
        }
        PrimaryButton(label = stringResource(labels.primary), onClick = onPrimary)
    }
}

/** 页顶圆盘的三种样子：进行中、成功、失败。三态同位，只换颜色与字形，结局到达时页面不跳。 */
private enum class OrbLook { Running, Done, Failed }

/** 圆盘 `64` → `12` → 结论 `22/600` → `4` → 说明 `14/400` 次级色，居中。 */
@Composable
private fun ResultHeader(orb: OrbLook, title: String, note: String?, noteFamily: FontFamily? = null) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        StatusOrb(
            icon = painterResource(
                when (orb) {
                    OrbLook.Running -> FluentR.drawable.ic_fluent_link_24_regular
                    OrbLook.Done -> FluentR.drawable.ic_fluent_checkmark_24_regular
                    OrbLook.Failed -> FluentR.drawable.ic_fluent_warning_24_regular
                },
            ),
            tint = when (orb) {
                OrbLook.Running -> Theme.colors.accent
                OrbLook.Done -> Theme.tones.success.fg
                OrbLook.Failed -> Theme.tones.error.fg
            },
            container = when (orb) {
                OrbLook.Running -> Theme.colors.accentContainer
                OrbLook.Done -> Theme.tones.success.container
                OrbLook.Failed -> Theme.tones.error.container
            },
            size = OrbSize.Header,
        )
        Spacer(Modifier.height(Theme.Spacing.md))
        Text(
            text = title,
            style = Theme.Type.pageTitle,
            color = Theme.colors.textPrimary,
            textAlign = TextAlign.Center,
        )
        if (note != null) {
            Spacer(Modifier.height(Theme.Spacing.xs))
            Text(
                text = note,
                style = Theme.Type.control.copy(fontWeight = FontWeight.Normal, fontFamily = noteFamily),
                color = Theme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ImportProgressRow(step: ImportProgressStep) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        StepMarker(step.status)
        // 阶段列表每行 = `20 × 20` 状态标记 + 阶段标签 `13`。进行中那一档的加粗是本行自己的强调，不改字号。
        Text(
            text = stringResource(step.label),
            style = Theme.Type.status,
            fontWeight = if (step.status == ImportProgressStatus.RUNNING) FontWeight.SemiBold else FontWeight.Normal,
            color = if (step.status == ImportProgressStatus.PENDING) {
                Theme.colors.textSecondary
            } else {
                Theme.colors.textPrimary
            },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StepMarker(status: ImportProgressStatus) {
    when (status) {
        ImportProgressStatus.RUNNING -> CircularProgressIndicator(modifier = Modifier.size(STEP_MARKER), strokeWidth = 2.dp)
        ImportProgressStatus.DONE -> Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_checkmark_24_regular),
            contentDescription = null,
            tint = Theme.tones.success.fg,
            modifier = Modifier.size(STEP_MARKER),
        )
        // 点本身 10，而**占位必须是 20**（每一支都占满 `20 × 20`）：
        // 三支标记的宽度决定各行标签的左边缘，只给其中一支设尺寸会让标签逐行错位。
        // 外层这一圈不是装饰，Apple 侧同样是两层 frame（10 的圆 + 20 的槽）。
        ImportProgressStatus.PENDING -> Box(
            modifier = Modifier.size(STEP_MARKER),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    // 给未到达的步点构造一个圆点色：这一支与另两支的区别是**图形**（圆点 / 转圈 / 对勾三个不同的形），不是同一个图形压暗。透明度字面量：禁用态那个令牌在这里没有落点。
                    .background(Theme.colors.textSecondary.copy(alpha = 0.35f), CircleShape),
            )
        }
    }
}

private enum class ImportProgressStatus {
    PENDING,
    RUNNING,
    DONE,
}

private data class ImportProgressStep(
    val label: Int,
    val status: ImportProgressStatus,
)

/**
 * 进行中那一态的步骤行。结论页不再列步骤：成功之后只剩一行打勾的「下载配置」，那是进度，结果页用不上；
 * 失败的原因由诊断框说。故这里只认进行中的相位，别的相位走到这里是页面分派漏了。
 */
private fun importSteps(
    phase: ImportViewModel.Phase,
    requestedApply: Boolean,
    willApply: Boolean,
): List<ImportProgressStep> {
    val includesVerification = requestedApply || phase == ImportViewModel.Phase.VERIFYING
    val includesStop = willApply ||
        phase == ImportViewModel.Phase.STOPPING ||
        phase == ImportViewModel.Phase.APPLYING
    val labels = buildList {
        if (includesVerification) add(R.string.import_step_verify)
        if (includesStop) add(R.string.import_step_stop)
        add(R.string.import_step_download)
        if (includesStop) add(R.string.import_step_apply)
    }
    val current = when (phase) {
        ImportViewModel.Phase.IDLE -> null
        ImportViewModel.Phase.VERIFYING -> R.string.import_step_verify
        ImportViewModel.Phase.STOPPING -> R.string.import_step_stop
        ImportViewModel.Phase.DOWNLOADING -> R.string.import_step_download
        ImportViewModel.Phase.APPLYING -> R.string.import_step_apply
        ImportViewModel.Phase.APPLIED,
        ImportViewModel.Phase.SUCCESS,
        ImportViewModel.Phase.ERROR_NETWORK,
        ImportViewModel.Phase.ERROR_HTTP,
        ImportViewModel.Phase.ERROR_CONTENT,
        ImportViewModel.Phase.ERROR_START,
        -> error("import steps are only shown while in progress: $phase")
    }
    return labels.map { label ->
        ImportProgressStep(
            label = label,
            status = when {
                current == null -> ImportProgressStatus.PENDING
                label == current -> ImportProgressStatus.RUNNING
                labels.indexOf(label) < labels.indexOf(current) -> ImportProgressStatus.DONE
                else -> ImportProgressStatus.PENDING
            },
        )
    }
}

internal fun importProgressTokens(
    phase: ImportViewModel.Phase,
    requestedApply: Boolean,
    willApply: Boolean = false,
): List<String> =
    importSteps(phase, requestedApply, willApply).map { step ->
        val label = when (step.label) {
            R.string.import_step_verify -> "verify"
            R.string.import_step_stop -> "stop"
            R.string.import_step_download -> "download"
            R.string.import_step_apply -> "apply"
            else -> error("unknown import step label")
        }
        "$label:${step.status.name.lowercase()}"
    }

/** 圆盘说明到主体、主体到按钮：两段都是 `24`（设计稿的节奏）。 */
private val HEADER_TO_BODY = Theme.Spacing.xl
private val STEP_MARKER = 20.dp

/** 诊断框的最大高：再长就在框内滚。 */
private val DIAGNOSTIC_MAX_HEIGHT = 96.dp
