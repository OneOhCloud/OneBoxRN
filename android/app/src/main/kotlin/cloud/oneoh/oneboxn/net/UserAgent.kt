package cloud.oneoh.oneboxn.net

import android.os.Build
import cloud.oneoh.oneboxn.BuildConfig
import java.util.Locale

// 对外协议契约 UA。
// 配置服务端按 User-Agent 决定下发格式：结构化客户端 UA → 引擎 JSON 配置；
// 裸 UA → Clash YAML（引擎不认）。这里的客户端标记（SFA）与引擎名（sing-box）
// 是服务端要求的协议字面量。
// 格式：`SFA/<appVer> (android <arch> <os>; sing-box <engineVer>; language <lang>)`。
object UserAgent {
    private const val CLIENT_TAG = "SFA"

    fun build(engineVersion: String): String {
        val appVersion = BuildConfig.VERSION_NAME
        val arch = Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
        val os = Build.VERSION.SDK_INT
        val language = Locale.getDefault().toLanguageTag()
        return "$CLIENT_TAG/$appVersion (android $arch $os; sing-box $engineVersion; language $language)"
    }
}
