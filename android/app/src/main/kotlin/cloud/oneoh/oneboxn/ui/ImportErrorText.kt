package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.ImportError

// 导入错误 → 用户文案的唯一映射（与 iOS App/UI/ImportErrorText.swift 同名对应）：
// 导入失败视图（分类行 + 详情框）与配置刷新失败 Alert 共用，全仓无第二处分类文案分支。

/** 失败视图标题：StartFailed 时下载已成功，标题按错误类分化（其余三类为下载失败）。 */
@Composable
internal fun importErrorTitle(error: ImportError): String = when (error) {
    is ImportError.StartFailed -> stringResource(R.string.import_start_failed)
    else -> stringResource(R.string.import_failed)
}

/** 分类提示行（i18n；HTTP 状态码内嵌于提示行）。 */
@Composable
internal fun importErrorHint(error: ImportError): String = when (error) {
    is ImportError.DownloadNetwork -> stringResource(R.string.import_error_network)
    is ImportError.DownloadHttp -> stringResource(R.string.import_error_http, error.statusCode.toString())
    is ImportError.InvalidContent -> stringResource(R.string.import_error_content)
    is ImportError.StartFailed -> stringResource(R.string.import_error_start)
}

/** 原始诊断详情（非 i18n：网络诊断/状态码/内容拒因/引擎诊断，原样呈现）。 */
internal fun importErrorDetail(error: ImportError): String = when (error) {
    is ImportError.DownloadNetwork -> error.message
    is ImportError.DownloadHttp -> "HTTP ${error.statusCode}"
    is ImportError.InvalidContent -> error.reason.name
    is ImportError.StartFailed -> error.message
}

/** 刷新失败 Alert 的单段文案：提示行 + 原始详情（HTTP 状态已含于提示行，不重复）。 */
@Composable
internal fun importErrorAlertText(error: ImportError): String = when (error) {
    is ImportError.DownloadHttp -> importErrorHint(error)
    else -> importErrorHint(error) + "\n" + importErrorDetail(error)
}
