package cloud.oneoh.oneboxn.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R

// 外链的唯一出口：设置页（关于弹层的官网 / 隐私）与配置详情的头部共用。

/** 系统浏览器打开外链；无可用处理者是领域错误 → false 交调用方提示（仅此边界类型化，不吞其它故障）。 */
internal fun openExternalLink(context: Context, url: String): Boolean =
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        true
    } catch (missing: ActivityNotFoundException) {
        false
    }

/** 打不开外链时的提示：只说打不开，确认即收起，调用方留在原处。 */
@Composable
internal fun LinkOpenFailedDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_link_error)) },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.ok))
            }
        },
    )
}
