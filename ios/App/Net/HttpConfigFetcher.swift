import Foundation
import Core

// ConfigFetcher 端口的 iOS 实现：URLSession GET，整体 30s 上限，
// 跟随重定向 ≤5 次；携带结构化 UA 与 Accept 头。传输层失败（超时/DNS/TLS/断网）原样抛出；
// 任何 HTTP 状态码都以 FetchReply 原样返回（含头全量透传），状态判定归 core。
// 与 Android net/HttpConfigFetcher.kt 同名对应。
final class HttpConfigFetcher: ConfigFetcher, Sendable {
    private let session: URLSession

    convenience init() {
        self.init(protocolClasses: nil)
    }

    /// 测试缝：只允许注入 `URLProtocol` 桩，超时等参数不可改——它们是生产配置值，
    /// 让测试能改就等于让测试测的不是生产配置。默认 nil = 生产路径逐字不变。
    init(protocolClasses: [AnyClass]?) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 30
        if let protocolClasses { configuration.protocolClasses = protocolClasses }
        session = URLSession(configuration: configuration)
    }

    /// 取消归一在最外层：`bytes(for:)` 与读取循环都可能抛 `URLError.cancelled`，
    /// 只裹其中一段就会漏。原样上抛会被 core 的错误边界判成 downloadNetwork——
    /// Apple 出失败终态而 Android 透传取消，同一次「离开导入页」两端结局不同。
    func fetch(url: String, userAgent: String) async throws -> FetchReply {
        do {
            return try await performFetch(url: url, userAgent: userAgent)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        }
    }

    private func performFetch(url: String, userAgent: String) async throws -> FetchReply {
        guard let requestUrl = URL(string: url) else {
            // 非法 URL 属外部输入的传输层失败面：抛出后由 core 归入 downloadNetwork。
            throw URLError(.badURL)
        }
        var request = URLRequest(url: requestUrl)
        request.httpMethod = "GET"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json, */*", forHTTPHeaderField: "Accept")
        // 边读边计，不用 `data(for:)`：后者把响应**全量缓冲**后才交回，任何「读完再判长度」的写法
        // 都是在内存已经吃掉之后才生效（体积上限）。与 Android `readUtf8Body` 同形。
        let (stream, response) = try await session.bytes(for: request, delegate: RedirectLimiter())
        // 提前退出（超限/非 HTTP 响应）必须**取消底层任务**：停止迭代只是不再取字节，
        // 传输由 `stream.task` 持有，不取消就还在收、还在缓冲——「有界」就又只是名义上的。
        defer { stream.task.cancel() }
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        if http.expectedContentLength > Int64(ConfigResourceLimits.maxImportedConfigSize) {
            throw responseTooLarge()   // 声明就超限：不必开始读
        }
        let body = try await boundedUtf8Body(stream, maximumBytes: ConfigResourceLimits.maxImportedConfigSize)
        // allHeaderFields 已按大小写不敏感合并同名头（多值逗号连接），满足端口「头名唯一」契约。
        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
            guard let name = name as? String, let value = value as? String else { continue }
            headers[name] = value
        }
        return FetchReply(
            status: http.statusCode,
            body: body,
            headers: headers
        )
    }
}

/// 逐块累积且在写入前检查上限，未声明长度与分块传输也不能绕过内存边界。
/// 与 Android `readUtf8Body` 同形；泛型化是为了能用普通序列直接测这条边界。
internal func boundedUtf8Body<Bytes: AsyncSequence>(
    _ stream: Bytes,
    maximumBytes: Int
) async throws -> String where Bytes.Element == UInt8 {
    precondition(maximumBytes > 0, "maximumBytes must be positive")
    var bytes: [UInt8] = []
    bytes.reserveCapacity(min(maximumBytes, 16 * 1024))
    for try await byte in stream {
        if bytes.count == maximumBytes { throw responseTooLarge() }
        bytes.append(byte)
    }
    return String(decoding: bytes, as: UTF8.self)
}

/// 归入传输层失败面：core 在边界把它类型化为 downloadNetwork。
internal func responseTooLarge() -> URLError { URLError(.dataLengthExceedsMaximum) }

// 重定向计数（≤5 次）：超限不再跟随，把重定向响应原样交给上层——非 2xx 由 core 判为 downloadHttp。
// 回调由 session 的串行 delegate 队列投递，count 无并发访问，故 @unchecked Sendable。
private final class RedirectLimiter: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private static let limit = 5
    private var count = 0

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        count += 1
        return count > Self.limit ? nil : request
    }
}
