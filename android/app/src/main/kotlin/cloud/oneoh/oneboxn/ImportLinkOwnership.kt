package cloud.oneoh.oneboxn

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

// 本 App 与 OneBoxN 注册同一个深链 scheme，OneBoxN 在设备上时由它优先导入：
// 本 App 撤下深链入口，系统便只把链接交给它，不再弹二选一。
internal object ImportLinkOwnership {
    private const val PREFERRED_HANDLER_PACKAGE = "cloud.oneoh.oneboxn"

    // 清单里承载深链 intent-filter 的 activity-alias；类名按 namespace 解析，与 applicationId 无关。
    private const val ENTRY_ALIAS = "cloud.oneoh.oneboxn.ImportLinkEntry"

    /** 按 OneBoxN 在不在设备上启停深链入口；只在与期望不一致时写。 */
    fun syncEntry(context: Context) {
        val packageManager = context.packageManager
        val entry = ComponentName(context, ENTRY_ALIAS)
        val desired = if (preferredHandlerInstalled(context)) {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
        }
        if (packageManager.getComponentEnabledSetting(entry) != desired) {
            packageManager.setComponentEnabledSetting(entry, desired, PackageManager.DONT_KILL_APP)
        }
    }

    /**
     * 入口撤下之前发出的链接仍可能落到本 App：OneBoxN 在就原样转交给它，本 App 不导入。
     * 返回是否已转交；OneBoxN 不在或接不住这条链接时返回 false，由本 App 照常导入。
     */
    fun forwardToPreferredHandler(context: Context, link: String): Boolean {
        if (!preferredHandlerInstalled(context)) return false
        val forward = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(PREFERRED_HANDLER_PACKAGE)
        return try {
            context.startActivity(forward)
            true
        } catch (unsupported: ActivityNotFoundException) {
            false
        }
    }

    private fun preferredHandlerInstalled(context: Context): Boolean =
        try {
            context.packageManager.getPackageInfo(PREFERRED_HANDLER_PACKAGE, 0)
            true
        } catch (absent: PackageManager.NameNotFoundException) {
            false
        }
}
