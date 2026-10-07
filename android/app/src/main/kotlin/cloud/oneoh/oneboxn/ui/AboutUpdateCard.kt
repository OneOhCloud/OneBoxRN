package cloud.oneoh.oneboxn.ui

import androidx.annotation.StringRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.update.AppUpdater
import cloud.oneoh.oneboxn.update.UpdateCheckStatus
import cloud.oneoh.oneboxn.update.UpdateState
import cloud.oneoh.oneboxn.ui.components.SettingsGroup
import cloud.oneoh.oneboxn.ui.components.TextHeightGlyph
import cloud.oneoh.oneboxn.ui.components.TonalCapsuleButton
import cloud.oneoh.oneboxn.ui.components.preferenceRowPadding
import com.microsoft.fluent.mobile.icons.R as FluentR

// 关于弹层的版本行：全应用唯一的更新入口。一行说清「有没有新版本」，行尾一颗贴合内容、图标在字前的胶囊做下一步；
// 整行不可点，免得「看一眼版本」被读成「开始更新」。「更新」只把用户带去商店页或下载网页，应用自己不下载不安装。

/** 行尾胶囊做哪一步；每态只有一颗。图标嵌在胶囊里、文字之前，只是文字的第二通道，读屏只念文字。 */
internal enum class UpdateRowAction(@StringRes val label: Int) {
    CHECK(R.string.update_check_now),
    UPDATE(R.string.update_action_update),
}

/**
 * 刷新类动作取 `arrow_sync`：两段弧中心对称，绕几何中心转时墨迹质心不动；`arrow_clockwise` 只有一个箭头，质心偏出中心近 2px，转起来是绕偏心点晃。静止与旋转同一枚。
 */
@Composable
private fun UpdateRowAction.painter(): Painter = when (this) {
    UpdateRowAction.CHECK -> painterResource(FluentR.drawable.ic_fluent_arrow_sync_24_regular)
    UpdateRowAction.UPDATE -> painterResource(FluentR.drawable.ic_fluent_arrow_download_24_regular)
}

/**
 * [newVersionLabel] 是有新版本时标题里的版本串，null 时行标题是「软件更新」（已装版本在 logo 下已有，不再说第二遍）。
 * [subtitle] 没有可说的就不占行；[failed] 让副标题取错误色（文字本身已说清失败，颜色只是第二通道）。
 */
internal data class UpdateRowContent(
    val newVersionLabel: String?,
    @StringRes val subtitle: Int?,
    val action: UpdateRowAction,
    val failed: Boolean,
)

internal fun updateRowContent(state: UpdateState, check: UpdateCheckStatus): UpdateRowContent = when (state) {
    UpdateState.None -> UpdateRowContent(
        newVersionLabel = null,
        subtitle = checkSubtitle(check),
        action = UpdateRowAction.CHECK,
        failed = check == UpdateCheckStatus.FAILED,
    )
    is UpdateState.Available -> UpdateRowContent(
        // 商店只给目标构建号，版本名不明时只显示构建号，不拿已装的版本名冒充。
        newVersionLabel = state.build.toString(),
        subtitle = null,
        action = UpdateRowAction.UPDATE,
        failed = false,
    )
}

@StringRes
private fun checkSubtitle(check: UpdateCheckStatus): Int? = when (check) {
    UpdateCheckStatus.IDLE -> null
    UpdateCheckStatus.CHECKING -> R.string.update_checking
    UpdateCheckStatus.UP_TO_DATE -> R.string.update_up_to_date
    UpdateCheckStatus.FAILED -> R.string.update_check_failed
}

@Composable
fun AboutUpdateCard(updater: AppUpdater) {
    val state by updater.state.collectAsStateWithLifecycle()
    val check by updater.checkStatus.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val content = updateRowContent(state, check)
    SettingsGroup(label = null) {
        UpdateRow(
            content = content,
            checking = check == UpdateCheckStatus.CHECKING,
            onAction = {
                when (content.action) {
                    UpdateRowAction.CHECK -> updater.checkNow()
                    UpdateRowAction.UPDATE -> updater.openUpdate(context)
                }
            },
        )
    }
}

@Composable
private fun UpdateRow(content: UpdateRowContent, checking: Boolean, onAction: () -> Unit) {
    val spin = rememberCheckSpin()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.md),
        modifier = Modifier.fillMaxWidth().preferenceRowPadding(),
    ) {
        // 标题与状态读成一句（「软件更新，已是最新版本」）：分成两个焦点，状态就脱离了它说的是什么。
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.weight(1f).semantics(mergeDescendants = true) {},
        ) {
            Text(
                text = content.newVersionLabel?.let { stringResource(R.string.update_available_title, it) }
                    ?: stringResource(R.string.update_section_title),
                style = Theme.Type.rowTitle,
                color = Theme.colors.textPrimary,
            )
            content.subtitle?.let { subtitle ->
                Text(
                    text = stringResource(subtitle),
                    style = Theme.Type.subtitle,
                    color = if (content.failed) Theme.tones.error.fg else Theme.colors.textSecondary,
                )
            }
        }
        TonalCapsuleButton(onClick = onAction, enabled = !checking) {
            CapsuleActionIcon(
                action = content.action,
                rotationDegrees = if (checking && content.action == UpdateRowAction.CHECK) spin else NO_ROTATION,
            )
            Text(text = stringResource(content.action.label), style = Theme.Type.status)
        }
    }
}

/**
 * 胶囊里的动作图标。转动只作用在这块定宽定高的正方形图层上，轴心是图层中心，也就是字形的几何中心：
 * 套在非正方形或含文字的容器上转，轴心会落到容器中心，图标就会绕着偏心点晃。
 */
@Composable
internal fun CapsuleActionIcon(action: UpdateRowAction, rotationDegrees: () -> Float) {
    TextHeightGlyph(painter = action.painter(), modifier = Modifier.graphicsLayer { rotationZ = rotationDegrees() })
}

private val NO_ROTATION: () -> Float = { 0f }

/** 检查中刷新图标的转角；系统关掉动画时停在 0°，等待时长照旧由检查编排保证。 */
@Composable
private fun rememberCheckSpin(): () -> Float {
    if (Theme.reduceMotion) return { 0f }
    val angle = rememberInfiniteTransition(label = "checkSpin").animateFloat(
        initialValue = 0f,
        targetValue = FULL_TURN_DEGREES,
        animationSpec = infiniteRepeatable(tween(SPIN_PERIOD_MS, easing = LinearEasing)),
        label = "checkSpinAngle",
    )
    return { angle.value }
}

private const val FULL_TURN_DEGREES = 360f
private const val SPIN_PERIOD_MS = 1000
