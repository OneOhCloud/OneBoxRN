package cloud.oneoh.oneboxn

import android.content.Intent
import android.os.Bundle
import android.service.quicksettings.TileService
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cloud.oneoh.oneboxn.ui.AppNav
import cloud.oneoh.oneboxn.ui.AppTheme

// 单 Activity：承载 Compose 树。
// 深链入口：冷启动 intent 与热启动 onNewIntent 两路汇合为单一待处理原串；
// 本层零解析分支，原串下传由 core ImportLink 唯一判定。
class MainActivity : ComponentActivity() {
    // 待处理深链原串；消费后清空并抹除 intent.data，Activity 重建不得重放。
    private var pendingDeepLink by mutableStateOf<String?>(null)

    // 待处理的「落回主页」请求；与深链同一条一次性纪律。
    private var pendingHomeTabRequest by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingDeepLink = intent?.dataString
        pendingHomeTabRequest = requestsHomeTab(intent?.action)
        val app = application as App
        setContent {
            AppTheme {
                AppNav(
                    actions = app.actions,
                    updater = app.updater,
                    deepLink = pendingDeepLink,
                    onDeepLinkConsumed = ::consumeDeepLink,
                    homeTabRequested = pendingHomeTabRequest,
                    onHomeTabRequestConsumed = ::consumeHomeTabRequest,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // setIntent 使消费时的 data 抹除作用于最新 intent；旧 intent 的深链已消费或本就为空。
        setIntent(intent)
        pendingDeepLink = intent.dataString
        pendingHomeTabRequest = requestsHomeTab(intent.action)
    }

    // 消费一次性：状态清空阻断本实例重放，intent.data 抹除阻断配置变更重建后的 onCreate 重放。
    private fun consumeDeepLink() {
        pendingDeepLink = null
        intent?.data = null
    }

    // 消费一次性：action 抹除阻断配置变更重建后把用户从当前 tab 拽回主页。
    private fun consumeHomeTabRequest() {
        pendingHomeTabRequest = false
        intent?.action = null
    }
}

// 磁贴长按落点：系统用这个 action 打开本 Activity；其余入口（桌面图标 / 深链）各按自己的规则落位。
internal fun requestsHomeTab(action: String?): Boolean = action == TileService.ACTION_QS_TILE_PREFERENCES
