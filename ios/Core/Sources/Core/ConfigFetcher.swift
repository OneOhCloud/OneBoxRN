import Foundation

// 配置抓取端口：core 只依赖本契约，HTTP 细节（UA 构造、超时、重定向）归平台实现。
// 契约：传输层失败（超时/DNS/TLS/断网）即抛平台异常；任何 HTTP 状态码都以 FetchReply 返回，状态判定归 core。
// 与 Android core/ConfigFetcher.kt 逐字对应。

public struct FetchReply: Sendable, Equatable {
    public let status: Int
    public let body: String
    public let headers: [String: String]

    public init(status: Int, body: String, headers: [String: String]) {
        self.status = status
        self.body = body
        self.headers = headers
    }

    /// 头名大小写不敏感取首个匹配；缺失 → ""（HTTP 头缺失是常态输入，空串 = 领域缺省）。
    /// 端口实现保证头名唯一（同名多值已合并），仅大小写不同的重复键不属契约。
    public func header(_ name: String) -> String {
        for (key, value) in headers where key.lowercased() == name.lowercased() {
            return value
        }
        return ""
    }
}

public protocol ConfigFetcher {
    /// GET url（携带 userAgent；整体 30s 上限与重定向 ≤5 次由实现持有）。
    func fetch(url: String, userAgent: String) async throws -> FetchReply
}
