import Foundation
import Network
import Core
import UIKit

// 自动检查新版本的唯一入口：冷启动、回前台、后台唤醒、网络恢复都经这里，是否真去查由 UpdateCheckSchedule 判定。
// 未启动（测试宿主）时各触发点全部空转，「立即检查」不经此处。
//
// 不另注册后台任务：搭配置刷新那一次 BGAppRefresh 的便车（见 AppMain）。
@MainActor
enum UpdateCheckTask {
    private static var checker: UpdateChecker?
    /// 冷启动那一次检查还没发出：由启动后的第一次 `run()` 消费。
    private static var coldStartPending = false
    private static var recoveryWatch: NetworkRecoveryWatch?
    private static var activationObserver: NSObjectProtocol?


    static func start(_ checker: UpdateChecker) {
        guard self.checker == nil else { return }
        self.checker = checker
        coldStartPending = true
        // 首装的「允许无线数据」授权只在进程活跃后才弹，装配期发出的请求必定失败；
        // 冷启动那次等到活跃再发。
        if UIApplication.shared.applicationState == .active {
            Task { await runFirst() }
        } else {
            activationObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { _ in
                Task { @MainActor in
                    if let observer = activationObserver { NotificationCenter.default.removeObserver(observer) }
                    activationObserver = nil
                    await runFirst()
                }
            }
        }
    }

    static func run() async {
        guard let checker else { return }
        let coldStart = coldStartPending
        coldStartPending = false
        await checker.checkIfDue(coldStart: coldStart)
    }

    /// 网络路径监视要等冷启动那次发出之后再起：监视器起步先回报一次当前状态，不能把它当成「恢复」。
    private static func runFirst() async {
        await run()
        recoveryWatch = NetworkRecoveryWatch()
    }
}

/// 网络路径从不可用变为可用时补一次检查（没碰到网络的那次检查不记账，这里是它的补查沿）。
@MainActor
private final class NetworkRecoveryWatch {
    private let monitor = NWPathMonitor()
    private var satisfied: Bool?

    init() {
        monitor.pathUpdateHandler = { path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self.observe(satisfied: satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "cloud.oneoh.networktools.update.path"))
    }

    private func observe(satisfied now: Bool) {
        let recovered = satisfied == false && now
        satisfied = now
        if recovered { Task { await UpdateCheckTask.run() } }
    }
}
