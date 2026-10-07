import Foundation
import BackgroundTasks

// 后台自动更新配置的 Apple 载体。
// 与 UI 同进程、共用同一个 ProfileStore，故写回直接发生，无结果槽。
@MainActor
enum RefreshTask {
    /// 与两份 Info.plist 的 BGTaskSchedulerPermittedIdentifiers 逐字一致；不一致时系统静默不投递。
    static let identifier = "cloud.oneoh.networktools.config-refresh"

    static let periodSeconds: TimeInterval = 1800

    /// 被叫醒后要跑的那件事。装配期注入一次（AppMain），两端共用。
    private static var runner: (() async -> Void)?


    static func install(_ run: @escaping () async -> Void) {
        runner = run
    }

    static func run() async {
        await runner?()
    }

    /// 开关为开则排期，为关则撤销。
    static func sync(enabled: Bool) {
        guard enabled else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            return
        }
        schedule()
    }

    /// 系统只保证「不早于」，不保证准时；每次执行完再排下一次，否则只会触发一次。
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: periodSeconds)
        // 提交失败（模拟器、未授权后台刷新、超出排期上限）不是领域错误：下次冷启动会再排一次。
        try? BGTaskScheduler.shared.submit(request)
    }
}
