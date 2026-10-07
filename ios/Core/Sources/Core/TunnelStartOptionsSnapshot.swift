import Foundation

public struct TunnelStartOptionsSnapshot: Equatable, Sendable {
    public static let fileName = "start_options.plist"
    public static let configKey = "config"
    public static let profileIdKey = "profile-id"

    public let config: String

    /// 用量记账归属：与本次启动所用配置同一次快照捕获。
    ///
    /// **空串是合法值**，语义为「未归属，本会话不记账」——debug 引导配置如此，
    /// 升级前写下的 On-Demand 快照（没有这个键）也如此。故它与 config 不同，
    /// 缺失不抛错：按必填解码会让升级后系统自动拉起的隧道直接起不来。
    public let profileId: String

    public init(config: String, profileId: String = "") throws {
        guard !config.isEmpty else {
            throw EngineError(token: "START_OPTIONS_INVALID", detail: "empty configuration")
        }
        self.config = config
        self.profileId = profileId
    }

    public init(options: [String: NSObject]?) throws {
        let config = options?[Self.configKey] as? String ?? ""
        let profileId = options?[Self.profileIdKey] as? String ?? ""
        try self.init(config: config, profileId: profileId)
    }

    /// 交给系统启动隧道的 options，也是落盘快照的内容：两处共用这一份，键集不会分叉。
    public var providerOptions: [String: NSObject] {
        [
            Self.configKey: config as NSString,
            Self.profileIdKey: profileId as NSString,
        ]
    }

    public func encoded() throws -> Data {
        try PropertyListSerialization.data(fromPropertyList: providerOptions, format: .binary, options: 0)
    }

    public static func decode(_ data: Data) throws -> TunnelStartOptionsSnapshot {
        let plist = try PropertyListSerialization.propertyList(from: data, options: [], format: nil)
        guard let options = plist as? [String: NSObject] else {
            throw EngineError(token: "START_OPTIONS_INVALID", detail: "invalid start options payload")
        }
        return try TunnelStartOptionsSnapshot(options: options)
    }
}
