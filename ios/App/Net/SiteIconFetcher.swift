import Foundation

// 站点图标（配置官网下的 favicon）的抓取：URLSession GET，整体 10s 上限、体积 256 KiB 上限。
// 只有 2xx 且体积在限内才交回字节。图标只是点缀：超时、断网、非 2xx、超限都只是「这一次没取到」，
// 一律交回 nil 由调用方回落地球图标——不上抛，也不进失败弹层。
final class SiteIconFetcher: Sendable {
    static let timeout: TimeInterval = 10
    static let maximumBytes = 256 * 1024

    private let session: URLSession

    convenience init() {
        self.init(protocolClasses: nil)
    }

    /// 测试缝：只允许注入 `URLProtocol` 桩，时限与上限不可改（理由同 `HttpConfigFetcher`）。
    init(protocolClasses: [AnyClass]?) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.timeout
        configuration.timeoutIntervalForResource = Self.timeout
        if let protocolClasses { configuration.protocolClasses = protocolClasses }
        session = URLSession(configuration: configuration)
    }

    func fetch(_ url: URL) async -> Data? {
        do {
            // 边读边计：体积上限要在字节进内存之前生效（同 HttpConfigFetcher）。
            let (stream, response) = try await session.bytes(from: url)
            defer { stream.task.cancel() }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  http.expectedContentLength <= Int64(Self.maximumBytes) else { return nil }
            var data = Data()
            for try await byte in stream {
                guard data.count < Self.maximumBytes else { return nil }
                data.append(byte)
            }
            return data.isEmpty ? nil : data
        } catch {
            return nil
        }
    }
}
