package cloud.oneoh.oneboxn

import android.content.SharedPreferences
import androidx.core.content.edit
import cloud.oneoh.oneboxn.core.RoutingMode

// 路由模式持久化：偏好存储只存 token，键与默认值的唯一定义处即此；
// token↔枚举映射唯一实现于 core RoutingMode（未知 token 在 fromToken 内即崩，枚举穷尽破坏）。
// 切换语义（立即持久化 + applyConfigurationChange）在 AppActions.setRoutingMode。
class RoutingModeStore(private val preferences: SharedPreferences) {
    fun get(): RoutingMode {
        val token = preferences.getString(KEY, null) ?: return DEFAULT
        return RoutingMode.fromToken(token)
    }

    fun set(mode: RoutingMode) {
        preferences.edit { putString(KEY, mode.token) }
    }

    private companion object {
        const val KEY = "routing-mode"
        val DEFAULT = RoutingMode.TUN_RULES
    }
}
