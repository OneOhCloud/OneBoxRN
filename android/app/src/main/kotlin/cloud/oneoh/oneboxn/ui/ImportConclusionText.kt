package cloud.oneoh.oneboxn.ui

import androidx.annotation.StringRes
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.ImportConclusion
import cloud.oneoh.oneboxn.core.ImportOutcome

// 导入结论页的文字。判定在 core `ImportConclusion`（golden 裁判），这里只把判定换成文案的资源。
// 取资源 id 而不是字符串，好让 JVM 单测够得到；取字符串交给界面那一层的 `stringResource`。

/** 导入成功页的四段文字：结论、后果、主按钮、次按钮。 */
internal data class ImportSuccessLabels(
    @StringRes val headline: Int,
    @StringRes val consequence: Int,
    @StringRes val primary: Int,
    @StringRes val secondary: Int,
)

/** 导入失败页的按钮：可重试时主按钮「重试」、次按钮「返回」；只能返回时只有一颗「返回」。 */
internal data class ImportFailureLabels(@StringRes val primary: Int, @StringRes val secondary: Int?)

internal fun importSuccessLabels(conclusion: ImportConclusion.Succeeded): ImportSuccessLabels = ImportSuccessLabels(
    headline = when (conclusion.outcome) {
        // 新增说「导入成功」，同一链接再导入说「配置已更新」。
        ImportOutcome.ADDED -> R.string.import_success
        ImportOutcome.UPDATED -> R.string.import_updated
    },
    consequence = when (conclusion.consequence) {
        ImportConclusion.Consequence.ACTIVE_NOW -> R.string.import_active_note
        ImportConclusion.Consequence.ACTIVE_AFTER_RECONNECT -> R.string.import_reconnect_note
    },
    primary = when (conclusion.primary) {
        ImportConclusion.PrimaryAction.CONNECT -> R.string.home_connect
        ImportConclusion.PrimaryAction.USE_NOW -> R.string.import_use_now
    },
    secondary = R.string.import_done,
)

internal fun importFailureLabels(conclusion: ImportConclusion.Failed): ImportFailureLabels = when (conclusion.actions) {
    ImportConclusion.FailureActions.RETRY_OR_BACK -> ImportFailureLabels(primary = R.string.config_retry, secondary = R.string.back)
    ImportConclusion.FailureActions.BACK_ONLY -> ImportFailureLabels(primary = R.string.back, secondary = null)
}
