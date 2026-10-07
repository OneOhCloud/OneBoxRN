import Foundation
import StoreKit
import Core

// 商店上架版本查询：App Store 公开的 lookup 接口，按 bundle id 与用户所在店面查。
struct AppStoreLookup: Sendable {
    private static let endpoint = "https://itunes.apple.com/lookup"
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 15
        session = URLSession(configuration: configuration)
    }

    func fetch() async throws -> StoreLookup {
        guard let bundleId = Bundle.main.bundleIdentifier else {
            preconditionFailure("bundle identifier missing from Info.plist")
        }
        let storefront = await Storefront.current
        let country = storefront.flatMap { StorefrontCountry.alpha2(fromStorefrontCode: $0.countryCode) }
        let url = Self.url(bundleId: bundleId, country: country)
        let (data, response) = try await classifyingTransportFailure { try await session.data(from: url) }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw StoreLookupFailure.unexpectedStatus((response as? HTTPURLResponse)?.statusCode)
        }
        let lookup = try AppStoreLookupResponse.lookup(from: data, storefront: country)
        return lookup
    }

    /// 缺店面国家码时不带 country：接口按美区回答，本应用不在美区上架即无结果，偏向不提示。
    static func url(bundleId: String, country: String?) -> URL {
        guard var components = URLComponents(string: endpoint) else {
            preconditionFailure("invalid lookup endpoint")
        }
        var items = [URLQueryItem(name: "bundleId", value: bundleId)]
        if let country { items.append(URLQueryItem(name: "country", value: country)) }
        components.queryItems = items
        guard let url = components.url else { preconditionFailure("invalid lookup query") }
        return url
    }
}

/// 一次商店查询的事实：问的是哪个店面、商店回了几条、上架的是哪个版本。
/// `release` 为 nil 即商店尚无此应用（未上架或本店面未售）。
struct StoreLookup: Equatable, Sendable {
    /// 查询带上的店面国家码；nil = 取不到店面，按商店默认店面回答。
    let storefront: String?
    let resultCount: Int
    let release: StoreRelease?
}

/// 商店查询的非传输失败；传输失败已由 `classifyingTransportFailure` 归为 `UpdateTransportFailure`。
enum StoreLookupFailure: Error, CustomStringConvertible {
    case unexpectedStatus(Int?)

    var description: String {
        switch self {
        case .unexpectedStatus(let status): "store lookup answered with status \(status.map(String.init) ?? "non-http")"
        }
    }
}

/// lookup 响应 → 查询事实。
enum AppStoreLookupResponse {
    private struct Body: Decodable {
        let resultCount: Int
        let results: [Item]
    }

    private struct Item: Decodable {
        let version: String
        let trackViewUrl: String
    }

    static func lookup(from data: Data, storefront: String?) throws -> StoreLookup {
        let body = try JSONDecoder().decode(Body.self, from: data)
        return StoreLookup(
            storefront: storefront,
            resultCount: body.resultCount,
            release: body.results.first.map { StoreRelease(version: $0.version, url: $0.trackViewUrl) }
        )
    }
}

/// StoreKit 店面给 ISO 3166-1 alpha-3（如 `CHN`），lookup 只认 alpha-2（`country=CHN` 回 400）。
enum StorefrontCountry {
    static func alpha2(fromStorefrontCode code: String) -> String? {
        // ICU 规范化区域子标签时把 alpha-3 映射为 alpha-2；无法映射的原样回来，长度判据即拒收。
        guard let region = Locale(identifier: "und_\(code)").region?.identifier,
              region.count == 2, region.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
        return region
    }
}

/// URLSession 的错误在 userInfo 里带着完整请求地址，`describe` 会把它整段打进日志；
/// 传输失败只留错误码，并据此区分「没碰到网络」与「商店本身出了问题」。
struct UpdateTransportFailure: Error, CustomStringConvertible {
    let code: Int

    var description: String { "update store lookup transport failed: NSURLErrorDomain code=\(code)" }

    /// 请求根本没碰到网络：不算一次尝试，不计入退避。
    var networkUnreachable: Bool { UnreachableNetwork.matches(urlErrorCode: code) }
}

func classifyingTransportFailure<Value>(_ body: () async throws -> Value) async throws -> Value {
    do {
        return try await body()
    } catch let error as URLError {
        throw UpdateTransportFailure(code: error.code.rawValue)
    }
}
