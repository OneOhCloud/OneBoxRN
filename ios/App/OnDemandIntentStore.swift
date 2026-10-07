import Foundation

/// 按需连接的**用户意图**。
///
/// 与 `NETunnelProviderManager.isOnDemandEnabled` 有意分家：那个是意图在系统侧的**投影**，
/// 手动停止沿必须把它压成假才停得住，而设置页 Toggle 显示的必须始终是意图本身。
/// 不分家的话，用户每按一次停止，Toggle 就会自己翻掉。
///
/// iOS 专属：Android 的保活入口是电池优化豁免，不存在这个开关。
struct OnDemandIntentStore {
    private static let key = "on-demand-intent"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 未写过 = 关：自动拉起是用户要主动打开的能力，不替他默认打开。
    func get() -> Bool { defaults.bool(forKey: Self.key) }

    func set(_ value: Bool) { defaults.set(value, forKey: Self.key) }
}
