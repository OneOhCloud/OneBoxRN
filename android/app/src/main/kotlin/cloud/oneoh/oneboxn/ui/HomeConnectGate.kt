package cloud.oneoh.oneboxn.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.net.VpnService
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.BackgroundRunPermission
import cloud.oneoh.oneboxn.NotificationPermission
import cloud.oneoh.oneboxn.R

/**
 * 连接前置授权链：VPN 授权 → 通知权限 → 后台运行豁免 → 启动。
 *
 * 本函数既产出「发起一次连接」这个动作，也就地挂上这条链需要的三个对话框——
 * 它们只为这条链存在，摆在别处就得把四个状态位一起搬出去。链走完才调 [start]，终点由调用方给。
 *
 * 通知权限与后台豁免都**不是连接门槛**：无论允许或拒绝都继续启动。
 * 只有 VPN 授权被拒会中止，那是用户选择而不是错误。
 */
@Composable
internal fun connectAction(start: () -> Unit, onPermissionDenied: () -> Unit): () -> Unit {
    val context = LocalContext.current
    val activity = checkNotNull(LocalActivity.current) { "connectAction requires an Activity host" }
    var showBackgroundRunDialog by remember { mutableStateOf(false) }
    var backgroundRunPromptShown by rememberSaveable { mutableStateOf(false) }
    var showNotificationSettingsDialog by remember { mutableStateOf(false) }
    var notificationPromptShown by rememberSaveable { mutableStateOf(false) }

    fun connectAfterBackgroundCheck() {
        if (!backgroundRunPromptShown && !BackgroundRunPermission.isAllowed(context)) {
            backgroundRunPromptShown = true
            showBackgroundRunDialog = true
            return
        }
        start()
    }

    val backgroundRunLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { start() }
    val notificationSettingsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { connectAfterBackgroundCheck() }
    val notificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        // 与扫码页同一判据：拒绝且 rationale 不再显示 = 系统不会再弹框，出路只剩设置页。
        // 先问再判，而不是问之前猜——「从没问过」与「已永久拒绝」在 API 上是同一个 false。
        if (!granted && !activity.shouldShowRequestPermissionRationale(NotificationPermission.PERMISSION)) {
            showNotificationSettingsDialog = true
        } else {
            connectAfterBackgroundCheck()
        }
    }

    fun connectAfterNotificationCheck() {
        if (notificationPromptShown || NotificationPermission.isGranted(context)) {
            connectAfterBackgroundCheck()
            return
        }
        notificationPromptShown = true
        notificationLauncher.launch(NotificationPermission.PERMISSION)
    }

    val consentLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) connectAfterNotificationCheck() else onPermissionDenied()
    }

    if (showBackgroundRunDialog) {
        AlertDialog(
            onDismissRequest = {
                showBackgroundRunDialog = false
                start()
            },
            title = { Text(stringResource(R.string.home_background_permission_title)) },
            text = { Text(stringResource(R.string.home_background_permission_message)) },
            confirmButton = {
                TextButton(onClick = {
                    showBackgroundRunDialog = false
                    try {
                        backgroundRunLauncher.launch(BackgroundRunPermission.requestIntent(context))
                    } catch (_: ActivityNotFoundException) {
                        start()
                    }
                }) {
                    Text(stringResource(R.string.home_background_permission_allow))
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showBackgroundRunDialog = false
                    start()
                }) {
                    Text(stringResource(R.string.home_background_permission_later))
                }
            },
        )
    }

    // 恢复路径：系统已不再弹权限框，唯一出路是本应用的通知设置。两支都继续启动——
    // 通知可见性不是连接门槛，这里只是不让「为什么没有通知」变成一个查不到答案的问题。
    if (showNotificationSettingsDialog) {
        AlertDialog(
            onDismissRequest = {
                showNotificationSettingsDialog = false
                connectAfterBackgroundCheck()
            },
            title = { Text(stringResource(R.string.home_notification_permission_title)) },
            text = { Text(stringResource(R.string.home_notification_permission_message)) },
            confirmButton = {
                TextButton(onClick = {
                    showNotificationSettingsDialog = false
                    try {
                        notificationSettingsLauncher.launch(NotificationPermission.settingsIntent(context))
                    } catch (_: ActivityNotFoundException) {
                        connectAfterBackgroundCheck()
                    }
                }) {
                    Text(stringResource(R.string.scan_open_settings))
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showNotificationSettingsDialog = false
                    connectAfterBackgroundCheck()
                }) {
                    Text(stringResource(R.string.home_background_permission_later))
                }
            },
        )
    }

    return {
        val consent = VpnService.prepare(context)
        // 两条分支都必须汇到通知权限那一步：授权已给过时走 else，
        // 而那正是绝大多数次连接的走法——漏在这里等于这条权限永远不会被申请。
        if (consent != null) consentLauncher.launch(consent) else connectAfterNotificationCheck()
    }
}
