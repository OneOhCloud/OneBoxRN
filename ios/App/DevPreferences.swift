import Foundation

// 开发者页各开关的持久化：键与默认值的唯一定义处即此。
// 语义（开关翻转带来什么）在 AppActions；本类型只搬值。
// 与 Android app/DevPreferences.kt 逐字对应。
struct DevPreferences {
    private static let forceFallbackKey = "dev-force-fallback"
    private static let backgroundRefreshKey = "dev-background-refresh"
    private static let forceFallbackDefault = false
    private static let backgroundRefreshDefault = true

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 强制走回落加速地址，默认关。
    func forceFallback() -> Bool {
        defaults.object(forKey: Self.forceFallbackKey) as? Bool ?? Self.forceFallbackDefault
    }

    func setForceFallback(_ enabled: Bool) {
        defaults.set(enabled, forKey: Self.forceFallbackKey)
    }

    /// 后台自动更新配置，默认开——周期更新本就是产品行为，本开关是它的关闸。
    func backgroundRefresh() -> Bool {
        defaults.object(forKey: Self.backgroundRefreshKey) as? Bool ?? Self.backgroundRefreshDefault
    }

    func setBackgroundRefresh(_ enabled: Bool) {
        defaults.set(enabled, forKey: Self.backgroundRefreshKey)
    }
}
