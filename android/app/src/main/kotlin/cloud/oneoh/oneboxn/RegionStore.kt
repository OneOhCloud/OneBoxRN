package cloud.oneoh.oneboxn

import android.content.SharedPreferences
import androidx.core.content.edit
import cloud.oneoh.oneboxn.core.Region

// 区域持久化：偏好存储只存 token，键与默认值的唯一定义处即此；
// token↔枚举映射唯一实现于 core Region（未知 token 在 fromToken 内即崩，枚举穷尽破坏）。
// 切换语义（立即持久化，零运行时效果——不重启、不进合并）在 AppActions.setRegion。
class RegionStore(private val preferences: SharedPreferences) {
    fun get(): Region {
        val token = preferences.getString(KEY, null) ?: return DEFAULT
        return Region.fromToken(token)
    }

    fun set(region: Region) {
        preferences.edit { putString(KEY, region.token) }
    }

    private companion object {
        const val KEY = "region"
        val DEFAULT = Region.CN
    }
}
