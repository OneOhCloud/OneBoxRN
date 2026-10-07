package cloud.oneoh.oneboxn

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings

/**
 * 前台服务通知的可见性权限。
 *
 * 它**不是**连接硬门槛：被拒时前台服务照常运行、隧道照常连接，只是通知栏没有那一条。
 * 本对象只回答「要不要问、问没问到、问不动了往哪去」。
 */
object NotificationPermission {
    const val PERMISSION: String = Manifest.permission.POST_NOTIFICATIONS

    /** API 33 起才有这条运行时权限；更低版本上通知恒可见，无需询问。 */
    fun isRequired(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    fun isGranted(context: Context): Boolean =
        !isRequired() ||
            context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    /**
     * 问不动之后的去处：系统不会再弹询问框，只能把用户送到本应用的通知设置。
     *
     * 判据（还能不能再问）由调用方经 `shouldShowRequestPermissionRationale` 取——那需要 Activity，
     * 而本对象只接受 Context（镜像 [BackgroundRunPermission] 的分工）。
     */
    fun settingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
}
