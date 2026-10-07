import Foundation

// 是否提示更新：已装营销版本 + 商店查询结果 → 二选一。golden/update-decision.json 是行为裁判。
// 只有 iOS 消费：Android 的判定由 Play 直接给出（带目标构建号），无需本地比较。

/// 商店查询结果：商店上架的营销版本与商店页地址。
public struct StoreRelease: Equatable, Sendable {
    public let version: String
    public let url: String

    public init(version: String, url: String) {
        self.version = version
        self.url = url
    }
}

public enum UpdateDecision: Equatable, Sendable {
    case none
    case storeAvailable(storeUrl: String)

    /// [store] 为 nil = 商店尚无本应用（未上架或本店面未售），不提示。
    public static func decide(installedVersion: String, store: StoreRelease?) throws -> UpdateDecision {
        guard let store else { return .none }
        return try compareVersions(store.version, installedVersion) > 0 ? .storeAvailable(storeUrl: store.url) : .none
    }

    /// 点分十进制逐段比较，缺的尾段按 0；含非数字段或空段即非法。
    private static func compareVersions(_ left: String, _ right: String) throws -> Int {
        let a = try versionComponents(left)
        let b = try versionComponents(right)
        for index in 0..<max(a.count, b.count) {
            let x = index < a.count ? a[index] : 0
            let y = index < b.count ? b[index] : 0
            if x != y { return x < y ? -1 : 1 }
        }
        return 0
    }

    private static func versionComponents(_ version: String) throws -> [Int64] {
        try version.split(separator: ".", omittingEmptySubsequences: false).map { component in
            guard !component.isEmpty, component.utf8.allSatisfy({ (0x30...0x39).contains($0) }),
                  let value = Int64(component) else {
                throw UpdateInputError(message: "invalid version: \(version)")
            }
            return value
        }
    }
}
