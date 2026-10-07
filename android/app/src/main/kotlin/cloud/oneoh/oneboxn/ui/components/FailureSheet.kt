package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.DiagnosisDetail
import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.FailureSource
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.writeText
import com.microsoft.fluent.mobile.icons.R as FluentR
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

// 全局启动失败弹层：真实 EngineError 呈现——错误 token 块 + 元信息块（时间 / 来源 / 配置指纹）
// + 可展开引擎诊断 + 复制详情（写剪贴板 + 触感）+「我知道了」。
// 最近日志块尚未接线（日志快照需在失败时刻采集）。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FailureSheet(
    error: EngineError,
    occurredAtMillis: Long?,
    configFingerprint: String?,
    source: FailureSource?,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    var expanded by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

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
                .padding(bottom = Theme.sheetBottomInset),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.failure_title),
                style = Theme.Type.sheetTitle,
                // 纯文本行在弹层内衬之外再内缩一档，与块里的文字落在同一条读字边线上（内衬只约束带底色的块）。
                modifier = Modifier
                    .padding(horizontal = Theme.Spacing.textInset)
                    .padding(top = Theme.Spacing.lg),
            )
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Theme.tones.error.container, RoundedCornerShape(Theme.Radius.control))
                    // 三个块一律 `Radius.control`（`18 − 6`）、块内边距 `12 × 10`。
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                Text(
                    text = stringResource(R.string.failure_token_label),
                    style = Theme.Type.subtitle,
                    color = Theme.colors.textSecondary,
                )
                Text(
                    text = error.token,
                    style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                    color = Theme.tones.error.fg,
                )
            }
            val timeText = failureTimeText(occurredAtMillis)
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Theme.colors.surface, RoundedCornerShape(Theme.Radius.control))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                MetaRow(stringResource(R.string.failure_time_label), timeText)
                MetaRow(
                    stringResource(R.string.failure_source_label),
                    failureSourceTextRes(source)?.let { stringResource(it) } ?: FAILURE_PLACEHOLDER,
                )
                MetaRow(stringResource(R.string.failure_fingerprint_label), configFingerprint ?: FAILURE_PLACEHOLDER)
            }
            error.detail?.let { detail ->
                TextButton(
                    onClick = { expanded = !expanded },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(
                        painter = painterResource(
                            if (expanded) {
                                FluentR.drawable.ic_fluent_chevron_up_24_regular
                            } else {
                                FluentR.drawable.ic_fluent_chevron_down_24_regular
                            },
                        ),
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        text = stringResource(if (expanded) R.string.failure_collapse else R.string.failure_expand),
                        style = Theme.Type.control,
                        fontWeight = FontWeight.Medium,
                    )
                }
                if (expanded) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Theme.colors.surface, RoundedCornerShape(Theme.Radius.control))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.failure_detail_label),
                            style = Theme.Type.subtitle,
                            color = Theme.colors.textSecondary,
                        )
                        // 树形而不是一行串到底：段与段的层级在 core 分好（`DiagnosisDetail`），
                        // 这里只画。读法同崩溃栈——首行是结局，下面各行是它的旁证。
                        // **与下面复制出去的那份走同一个投影**：粘到求助会话里的那份
                        // 与屏上必须同形，否则两处读起来是两次不同的失败。
                        Text(
                            text = DiagnosisDetail.tree(detail),
                            style = Theme.Type.subtitle.copy(fontFamily = FontFamily.Monospace),
                        )
                    }
                }
            }
            // 复制两态循环：默认色对 ↔ 成功对 + 勾选图标；写入剪贴板并给触感反馈。
            // 用共享的 `SecondaryButton`（两态循环就是它 `tone` 的用法），不手搓 M3 `Button`：
            // 同形不同源会让色对 / 字号 / 形状各自漂掉。
            //
            // 不设「窄了就退回竖排」的回落：加一条回落就是给后面每一处弹层都开了一个分支；
            // 窄档放不下时改的是**文案**，不是形态。
            ButtonRow {
                SecondaryButton(
                    label = stringResource(if (copied) R.string.failure_copied else R.string.failure_copy),
                    onClick = {
                        val diagnostics = failureDiagnosticsText(error, occurredAtMillis, configFingerprint)
                        scope.launch {
                            // 成功/失败均给触感（在协程外无条件触发），但「已复制」视觉态仅在写入无可检测失败时置位。
                            if (clipboard.writeText("diagnostics", diagnostics)) copied = true
                        }
                        // 复制 = light。
                        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    },
                    icon = painterResource(
                        if (copied) FluentR.drawable.ic_fluent_checkmark_24_regular else FluentR.drawable.ic_fluent_copy_24_regular,
                    ),
                    tone = if (copied) Theme.tones.success else Theme.secondaryAction,
                )
                PrimaryButton(
                    label = stringResource(R.string.failure_dismiss),
                    onClick = {
                        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
                    },
                )
            }
        }
    }
}

// 诊断元信息行：标签 + 等宽值（镜像 iOS StartFailureSheet 私有 MetaRow）。
@Composable
private fun MetaRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = Theme.Type.meta,
            color = Theme.colors.textSecondary,
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = value,
            style = Theme.Type.meta.copy(fontFamily = FontFamily.Monospace),
        )
    }
}

/** 无值即占位，不编造（无激活 profile 时确无指纹；挂载读到的历史失败确无时刻）。 */
internal const val FAILURE_PLACEHOLDER = "—"

// 失败时刻显示：仅主线程使用，单实例复用（同 LogsScreen 的 logTimeFormat）。
// 固定 Locale.US 钉死日历与数字字形（门禁 make check rule=locale）。
private val failureTimeFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

/**
 * 来源那一行的文案。**五档各有自己的词**，只有「登记方没记下」才占位「—」。
 *
 * **占位与说错不是一回事**：占位是「没有可声称的来源」，是本仓对无值的既有处置（同时间行、
 * 指纹行）；写死某一档（比如一律标成引擎报的）会让用户去查一个没有问题的地方。
 * **不许回落到任何一个具体来源**。
 *
 * 返回 `Int?` 而不是就地取字符串：这样它是个纯函数，JVM 单测能直接钉住这张映射表
 * （`FailureDiagnosticsTest`），不需要 Compose 或设备。
 */
internal fun failureSourceTextRes(source: FailureSource?): Int? = when (source) {
    FailureSource.ENGINE -> R.string.failure_source_engine
    FailureSource.TUNNEL -> R.string.failure_source_tunnel
    FailureSource.APP -> R.string.failure_source_app
    FailureSource.SYSTEM -> R.string.failure_source_system
    FailureSource.DIAGNOSTICS -> R.string.failure_source_diagnostics
    // 逐个列全而不写 `else`：新增一档来源时这里编译不过，比屏上静默多一个「—」好
    // （Kotlin 2.4 对枚举 when 强制穷尽）。
    // `null` **单独一臂**：它是「登记方没记下」，与上面五档「记了一档」不是一回事。
    null -> null
}

internal fun failureTimeText(occurredAtMillis: Long?): String =
    occurredAtMillis?.let { failureTimeFormat.format(Date(it)) } ?: FAILURE_PLACEHOLDER

/**
 * 复制给用户带走的诊断文本：字段与顺序两端逐字相同（镜像 iOS failureDiagnosticsText）；
 * `detail` 无值时整行不出现——粘贴到求助会话里的空字段只会让人以为诊断被截断了。
 */
internal fun failureDiagnosticsText(
    error: EngineError,
    occurredAtMillis: Long?,
    configFingerprint: String?,
): String = listOfNotNull(
    "token: ${error.token}",
    "time: ${failureTimeText(occurredAtMillis)}",
    "config: ${configFingerprint ?: FAILURE_PLACEHOLDER}",
    // 与屏上那一块同一个投影（`DiagnosisDetail.tree`）——两处各画一份迟早分叉。
    error.detail?.let { "detail: ${DiagnosisDetail.tree(it)}" },
).joinToString("\n")
