package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.ImportLink
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.LinkVerdict
import cloud.oneoh.oneboxn.ui.Theme
import com.microsoft.fluent.mobile.icons.R as FluentR
import kotlinx.coroutines.launch

// 导入 URL sheet（首页空态 CTA 与配置页导入行共用）。
// 手输判定经 core ImportLink.parse（唯一解析器）：Rejected → 输入框就地错误；
// Accepted → 关闭弹层并把载荷交给宿主导航（不发真实请求）。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportSheet(
    onSubmit: (ImportPayload) -> Unit,
    onScan: () -> Unit,
    onDismiss: () -> Unit,
) {
    // 与另两个编辑弹层一致跳过半屏档：内容因大字号超过半屏时，首次展示不该停在半屏（按内容求高）。
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var validationError by remember { mutableStateOf<String?>(null) }
    val invalidMessage = stringResource(R.string.import_url_invalid)

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
        containerColor = SheetPanel.PlainPanel.color(),
        shape = RoundedCornerShape(topStart = Theme.Radius.panel, topEnd = Theme.Radius.panel),
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = Theme.sheetInset)
                // 底部呼吸量：ModalBottomSheet 的 contentWindowInsets 默认已让开系统条，
                // 这一档是它之上的留白（故不再挂 navigationBarsPadding，外层已消费）。
                .padding(bottom = Theme.sheetBottomInset),
            verticalArrangement = Arrangement.spacedBy(Theme.Spacing.lg),
        ) {
            Text(
                text = stringResource(R.string.import_title),
                style = Theme.Type.pageTitle,
                color = Theme.colors.textPrimary,
                // 纯文本行在弹层内衬之外再内缩一档，与输入框里的文字落在同一条读字边线上。
                modifier = Modifier
                    .semantics { heading() }
                    .padding(horizontal = Theme.Spacing.textInset)
                    .padding(top = Theme.Spacing.xl),
            )
            InputField(
                caption = InputCaption.Label(stringResource(R.string.import_url_label)),
                ground = InputGround.Surface,
                value = url,
                onValueChange = { url = it },
                placeholder = "https://",
                error = validationError,
                errorIcon = painterResource(FluentR.drawable.ic_fluent_error_circle_24_regular),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Uri,
                ),
            )
            // 三颗同排、左弱中次右主：二维码与导入是拿到同一个 URL 的两条路，挨着主操作；
            // 不再分到前缘，分开后窄屏放不下一行会把它挤到上一行。
            ButtonRow(modifier = Modifier.padding(top = Theme.Spacing.sm)) {
                QuietButton(
                    label = stringResource(R.string.cancel),
                    onClick = { dismissThen {} },
                )
                SecondaryButton(
                    label = stringResource(R.string.import_scan),
                    icon = painterResource(FluentR.drawable.ic_fluent_scan_qr_code_24_regular),
                    onClick = { dismissThen(onScan) },
                )
                PrimaryButton(
                    label = stringResource(R.string.import_action),
                    onClick = {
                        // 原串直传：空白容忍属 core 的解析语义，UI 层不得自带 trim——
                        // 各端自己 trim 会让同一粘贴内容在一端接受、另一端拒绝。
                        when (val verdict = ImportLink.parse(url)) {
                            is LinkVerdict.Accepted -> {
                                validationError = null
                                dismissThen { onSubmit(verdict.payload) }
                            }
                            is LinkVerdict.Rejected -> validationError = invalidMessage
                        }
                    },
                )
            }
        }
    }
}
