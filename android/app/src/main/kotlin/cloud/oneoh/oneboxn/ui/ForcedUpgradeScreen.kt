package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.contentColorFor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.update.FORCED_UPGRADE_URL
import com.microsoft.fluent.mobile.icons.R as FluentR

// 强制升级页：取代整个应用界面，没有关闭入口（iOS 对等物 UI/ForcedUpgradeScreen）。
// 隧道的断开由 AppActions 负责，本页只呈现。
@Composable
fun ForcedUpgradeScreen() {
    val context = LocalContext.current
    var linkOpenFailed by remember { mutableStateOf(false) }
    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        // 本页不在根导航的 Scaffold 里，内容色要按同一底色自己推，否则深色下文字落回默认黑。
        contentColor = contentColorFor(Theme.colors.background),
    ) { padding ->
        EmptyState(
            icon = painterResource(FluentR.drawable.ic_fluent_arrow_circle_up_24_regular),
            title = stringResource(R.string.forced_upgrade_title),
            caption = stringResource(R.string.forced_upgrade_caption),
            modifier = Modifier.padding(padding).readableContentWidth().padding(horizontal = Theme.Spacing.lg),
            actionLabel = stringResource(R.string.forced_upgrade_action),
            onAction = { linkOpenFailed = !openExternalLink(context, FORCED_UPGRADE_URL) },
        )
    }
    if (linkOpenFailed) LinkOpenFailedDialog(onDismiss = { linkOpenFailed = false })
}
