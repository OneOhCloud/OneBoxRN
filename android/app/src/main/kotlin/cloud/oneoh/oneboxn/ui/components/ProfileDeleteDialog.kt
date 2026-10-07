package cloud.oneoh.oneboxn.ui.components

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.ui.Theme

/**
 * 删除一份配置前的二次确认（配置行长按菜单与配置详情共用）。取消零副作用。
 * 对话框居中、指不回触发它的那一行，故正文写出被删的那一份的名字。
 */
@Composable
fun ProfileDeleteDialog(profile: Profile, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.profiles_delete_confirm)) },
        text = { Text(profile.name) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(stringResource(R.string.delete), color = Theme.tones.error.fg)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}
