import Foundation

/// 隧道的网络包含范围：两个开关合成一个值——它们同时被摊到
/// `NEVPNProtocol` 的属性上，分开传会让装配处出现两个必须一起读的参数。
///
/// `includeAPNs` 默认开:Apple 的 `excludeAPNs` 默认排除推送，而「包含所有网络」的用户
/// 意图恰恰是「所有」；两个开关都要手动打开才生效不符合这个意图。它只在 `includeAllNetworks`
/// 为真时被系统读取，故单独打开它无任何效果。
struct NetworkInclusion: Equatable {
    var includeAllNetworks: Bool
    var includeAPNs: Bool
}

// 持久化：键与默认值的唯一定义处即此。
// 切换语义（立即持久化 + restartIfRunning）在 AppActions；取值到 NEVPNProtocol
// 五个属性的装配在 TunnelController.loadOrCreateManager。
//
// iOS 专属：Android 的 VpnService 本就全量接管，不存在 APNs 排除面。
struct NetworkInclusionStore {
    private static let allNetworksKey = "include-all-networks"
    private static let apnsKey = "include-apns"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func get() -> NetworkInclusion {
        NetworkInclusion(
            includeAllNetworks: defaults.bool(forKey: Self.allNetworksKey),
            // 未写过 = 默认开；`bool(forKey:)` 对缺键返回 false，故先问键在不在。
            includeAPNs: defaults.object(forKey: Self.apnsKey) as? Bool ?? true
        )
    }

    func set(_ value: NetworkInclusion) {
        defaults.set(value.includeAllNetworks, forKey: Self.allNetworksKey)
        defaults.set(value.includeAPNs, forKey: Self.apnsKey)
    }
}
