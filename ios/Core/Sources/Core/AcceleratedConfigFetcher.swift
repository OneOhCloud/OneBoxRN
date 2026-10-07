import Foundation

// 两跳抓取：主 URL 失败 → FetchPolicy 判定 → 命中则以加速 URL 再打一次。
// 装在 ConfigFetcher 端口上，故导入、手动刷新、后台自动更新三条路径共用同一实现，无分支。
// 与 Android core/AcceleratedConfigFetcher.kt 逐字对应。

/// 一次抓取走了哪条路、闸门怎么判的。纯观察面，不参与写回。
public struct FetchAttempt: Equatable, Sendable {
    public let route: FetchRoute
    public let denial: FallbackDenial?

    public init(route: FetchRoute, denial: FallbackDenial?) {
        self.route = route
        self.denial = denial
    }
}

/// 强制回落开关开着、闸门又不放行时，主 URL 从未真发出，没有平台错误可抛；
/// 造一个说明真实原因的领域错误，别把「没试过」伪装成「试了没通」。
public struct ForcedPrimaryUnavailable: Error, CustomStringConvertible {
    public init() {}
    public var description: String {
        "primary url skipped by force-fallback switch and fallback was denied"
    }
}

public final class AcceleratedConfigFetcher: ConfigFetcher {
    private let direct: ConfigFetcher
    private let trustedSha256: Set<String>
    private let acceleratorBase: () -> String
    private let forceFallback: () -> Bool
    private let onAttempt: (FetchAttempt) -> Void

    /// `onAttempt` 每次 fetch 结束（含失败）恰调一次。
    ///
    /// 之所以能用回调而不是塞进返回值：调用方保证任一时刻至多一个抓取在飞，
    /// 调用方读到的必是自己那一次的结果。并发抓取会打破该前提，故那条不变量是硬要求。
    public init(
        direct: ConfigFetcher,
        trustedSha256: Set<String>,
        acceleratorBase: @escaping () -> String,
        forceFallback: @escaping () -> Bool,
        onAttempt: @escaping (FetchAttempt) -> Void
    ) {
        self.direct = direct
        self.trustedSha256 = trustedSha256
        self.acceleratorBase = acceleratorBase
        self.forceFallback = forceFallback
        self.onAttempt = onAttempt
    }

    public func fetch(url: String, userAgent: String) async throws -> FetchReply {
        var primaryReply: FetchReply?
        var primaryFailure: Error?
        let failure: FetchFailureKind

        if forceFallback() {
            // 主 URL 这一跳直接判为网络层失败，不实际发出；闸门照常。
            failure = .network
        } else {
            do {
                let reply = try await direct.fetch(url: url, userAgent: userAgent)
                if (200...299).contains(reply.status) {
                    onAttempt(FetchAttempt(route: .primary, denial: nil))
                    return reply
                }
                primaryReply = reply
                failure = .http
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                primaryFailure = error
                failure = .network
            }
        }

        switch FetchPolicy.decide(FetchPolicyInput(
            url: url,
            failure: failure,
            trustedSha256: trustedSha256,
            acceleratorBase: acceleratorBase()
        )) {
        case .denied(let reason):
            onAttempt(FetchAttempt(route: .primary, denial: reason))
            if let reply = primaryReply { return reply }
            throw primaryFailure ?? ForcedPrimaryUnavailable()
        case .accelerate(let acceleratedUrl):
            onAttempt(FetchAttempt(route: .accelerated, denial: nil))
            return try await direct.fetch(url: acceleratedUrl, userAgent: userAgent)
        }
    }
}
