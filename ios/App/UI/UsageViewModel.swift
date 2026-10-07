import Foundation
import Observation
import Core

// 本机用量页：进入读一次、回前台读一次，不轮询——账本每分钟才变一次。
// 档位切换只重投影，不重新读盘（三档来自同一份已读入的账本）。
// 与 Android ui/UsageViewModel.kt 逐字对应。
@MainActor
@Observable
final class UsageViewModel {
    private let actions: AppActions
    private let profileId: String
    @ObservationIgnored private let now: @Sendable () -> Date

    private(set) var tier: UsageTier = .today
    private(set) var series = UsageSeries(cells: [], totalUp: 0, totalDown: 0)

    /// 该配置尚无账本文件 → 空态；与「这一档没用过」是两回事（后者仍展示零值区间）。
    private(set) var hasRecord = false
    private(set) var loaded = false

    @ObservationIgnored private var history = UsageHistory.empty

    init(actions: AppActions, profileId: String, now: @escaping @Sendable () -> Date = { Date() }) {
        self.actions = actions
        self.profileId = profileId
        self.now = now
    }

    func select(_ next: UsageTier) {
        tier = next
        series = project()
    }

    func refresh() async {
        let snapshot = await actions.usageRecord(profileId: profileId)
        hasRecord = snapshot.hasRecord
        history = snapshot.history
        series = project()
        loaded = true
    }

    private func project() -> UsageSeries {
        projectUsage(history, tier: tier, now: now())
    }
}
