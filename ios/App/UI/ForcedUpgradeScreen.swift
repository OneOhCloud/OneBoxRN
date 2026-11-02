import SwiftUI

// 强制升级页：取代整个应用界面，没有关闭入口（Android 对等物 ui/ForcedUpgradeScreen.kt）。
// 隧道在 App 外（控制中心、按需连接）也能被拉起，所以只要本页在屏上，每次进入运行都再断一次。
struct ForcedUpgradeScreen: View {
    let actions: AppActions
    @Environment(\.openURL) private var openURL
    @State private var linkOpenFailed = false

    var body: some View {
        EmptyState(
            systemImage: "arrow.up.circle",
            title: tr("forced_upgrade_title"),
            caption: tr("forced_upgrade_caption"),
            actionLabel: tr("forced_upgrade_action"),
            action: openDestination
        )
        .padding(.horizontal, Theme.Spacing.large)
        .screenBackground()
        .alert(tr("settings_link_error"), isPresented: $linkOpenFailed) {}
        .task(id: actions.forcedUpgradeBlocksTunnel) {
            if actions.forcedUpgradeBlocksTunnel { actions.disconnect() }
        }
    }

    private func openDestination() {
        openURL(ForcedUpgradeDestination.url, completion: linkOpenCompletion { linkOpenFailed = true })
    }
}
