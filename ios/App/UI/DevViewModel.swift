import Foundation
import Observation
import Core

// 开发者页状态：两个开关的乐观本地态 + 持久化转发。
// 镜像 Android ui/DevViewModel.kt。
@MainActor
@Observable
final class DevViewModel {
    @ObservationIgnored private let actions: AppActions

    private(set) var forceFallbackEnabled: Bool
    private(set) var backgroundRefreshEnabled: Bool

    init(actions: AppActions) {
        self.actions = actions
        forceFallbackEnabled = actions.forceFallback()
        backgroundRefreshEnabled = actions.backgroundRefresh()
    }

    /// 翻转即持久化，不弹确认（与设置页开关同样立即生效）。
    func setForceFallback(_ enabled: Bool) {
        forceFallbackEnabled = enabled
        actions.setForceFallback(enabled)
    }

    /// 翻转即持久化并即刻同步周期任务的注册/注销。
    func setBackgroundRefresh(_ enabled: Bool) {
        backgroundRefreshEnabled = enabled
        actions.setBackgroundRefresh(enabled)
    }


    // MARK: - 观察通道健康度（只读，零命令、零持久化、零轮询）

    /// 未连接时四项均为占位「—」：那时本就没有通道，报「absent」会让人以为出了故障。
    var observationAvailable: Bool { actions.connected }

    /// 端点状态 token（`bound` / `busy` / `absent`）——英文 token 与日志同形，不进 i18n。
    var observationEndpoint: String {
        observationAvailable ? actions.observationHealth.endpoint.rawValue : Self.placeholder
    }

    /// 距最近一帧的秒数；本次会话尚无帧时为占位。
    var observationLastFrame: String {
        guard observationAvailable, let elapsed = actions.observationElapsedMillis else {
            return Self.placeholder
        }
        return "\(elapsed / 1000)s"
    }

    /// 本次会话的通道重建次数：稳态恒为 0，非 0 即说明这条通道断过（通道自愈的应用内证据）。
    var observationRebuilds: String {
        observationAvailable ? String(actions.observationHealth.rebuildCount) : Self.placeholder
    }

    private static let placeholder = "—"
}
