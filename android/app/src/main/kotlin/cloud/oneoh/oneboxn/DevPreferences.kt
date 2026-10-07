package cloud.oneoh.oneboxn

import android.content.SharedPreferences
import androidx.core.content.edit

// 开发者页两个开关的持久化：键与默认值的唯一定义处即此。
// 语义（开关翻转带来什么）在 AppActions；本类只搬值。
// 与 iOS App/DevPreferences.swift 逐字对应。
class DevPreferences(private val preferences: SharedPreferences) {
    /** 强制走回落加速地址，默认关。 */
    fun forceFallback(): Boolean = preferences.getBoolean(KEY_FORCE_FALLBACK, FORCE_FALLBACK_DEFAULT)

    fun setForceFallback(enabled: Boolean) {
        preferences.edit { putBoolean(KEY_FORCE_FALLBACK, enabled) }
    }

    /** 后台自动更新配置，默认开——周期更新本就是产品行为，本开关是它的关闸。 */
    fun backgroundRefresh(): Boolean =
        preferences.getBoolean(KEY_BACKGROUND_REFRESH, BACKGROUND_REFRESH_DEFAULT)

    fun setBackgroundRefresh(enabled: Boolean) {
        preferences.edit { putBoolean(KEY_BACKGROUND_REFRESH, enabled) }
    }

    private companion object {
        const val KEY_FORCE_FALLBACK = "dev-force-fallback"
        const val KEY_BACKGROUND_REFRESH = "dev-background-refresh"
        const val FORCE_FALLBACK_DEFAULT = false
        const val BACKGROUND_REFRESH_DEFAULT = true
    }
}
