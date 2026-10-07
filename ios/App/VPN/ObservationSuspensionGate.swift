import Foundation
import UIKit

/// 「本进程现在可以持有共享容器里的端点所有权吗」这一问题的单一来源。
///
/// 判据是**进程可否被系统挂起**，不是「用户看不看得见」：iOS 挂起时仍持有 App Group 容器内的
/// 文件锁，RunningBoard 一律 `SIGKILL`（`0xdead10cc`）。
///
/// **初值取当前进程状态，不是「默认开着等通知」**：App 可被系统直接唤起到后台（后台刷新），
/// 那条路径上根本不会送来「进入后台」的通知——只订阅迁移沿等于对最短的一条崩溃路径不设防。
///
/// 构造必须在主线程（要读 `UIApplication`），而读取与订阅由锁保护、任意线程可用：观察绑定的
/// 构造发生在哪条线程由 `MonitorDispatch` 的惰性选核决定，不受调用方约束。
final class ObservationSuspensionGate: @unchecked Sendable {
    private let lock = NSLock()
    private var open: Bool
    /// 消费方回调。每个已实例化的观察绑定注册一次（本 App 至多两个），故不做注销。
    /// 回调一律 `[weak]` 捕获宿主，闸门不延长任何人的寿命。
    private var consumers: [(Bool) -> Void] = []
    private var observers: [NSObjectProtocol] = []

    /// - Parameter isOpenInitially: 测试注入用；生产走 `MainActor` 那个构造器，从平台读真值。
    init(isOpenInitially: Bool) {
        open = isOpenInitially
    }

    /// 恒开的闸门：给「本用例与挂起沿无关」的测试用，读起来就是一句声明。
    static var opened: ObservationSuspensionGate { ObservationSuspensionGate(isOpenInitially: true) }

    @MainActor
    convenience init(notificationCenter: NotificationCenter = .default) {
        self.init(isOpenInitially: UIApplication.shared.applicationState != .background)
        observe(name: UIApplication.didEnterBackgroundNotification, transition: .close, on: notificationCenter)
        observe(name: UIApplication.willEnterForegroundNotification, transition: .open, on: notificationCenter)
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    var isOpen: Bool {
        lock.lock()
        defer { lock.unlock() }
        return open
    }

    /// 注册消费方并返回当前值——「读初值」与「订阅后续」必须是一步，否则两步之间的翻转会丢。
    @discardableResult
    func addConsumer(_ consumer: @escaping (Bool) -> Void) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        consumers.append(consumer)
        return open
    }

    /// 翻转闸门。生产由前后台通知沿调用（主线程），测试直接调。
    func set(_ transition: GateTransition) {
        let next = transition == .open
        lock.lock()
        guard open != next else {
            lock.unlock()
            return
        }
        open = next
        let current = consumers
        lock.unlock()
        // 回调在**调用线程**上同步跑完：交还端点必须与「进入后台」同步发生，排到下一轮就
        // 可能排到挂起之后。
        for consumer in current { consumer(next) }
    }

    private func observe(name: Notification.Name, transition: GateTransition, on center: NotificationCenter) {
        let observer = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            self?.set(transition)
        }
        lock.lock()
        observers.append(observer)
        lock.unlock()
    }
}

enum GateTransition {
    case open
    case close
}
