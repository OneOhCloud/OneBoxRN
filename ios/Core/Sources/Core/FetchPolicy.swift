import Foundation

// 配置抓取的回落判定：主 URL 这一跳失败后，判定能否改打加速代理，
// 以及加速 URL 长什么样。纯函数，无 IO——抓取壳按判定执行，记录面按同一份输入复算得同一结论。
// 与 Android core/FetchPolicy.kt 逐字对应，golden/fetch-policy.json 是行为裁判。

/// 主 URL 那一跳的失败类别。分类归抓取壳（平台异常 → 本词表）。
public enum FetchFailureKind: String, Sendable {
    /// 传输层失败：超时 / DNS / TLS / 断网。唯一有回落资格的类别。
    case network = "NETWORK"
    /// 服务器作了应答但状态码非 2xx。
    case http = "HTTP"
    /// 调用方取消。
    case cancelled = "CANCELLED"
}

/// 抓取实际走的路。
public enum FetchRoute: String, Sendable {
    case primary = "PRIMARY"
    case accelerated = "ACCELERATED"
}

/// 不回落的理由。恰一个「回落」结局，故放行不在本词表内。
public enum FallbackDenial: String, Sendable {
    /// 服务器可达且作了应答，换条路也是同一个答案。
    case httpNoFallback = "HTTP_NO_FALLBACK"
    case cancelled = "CANCELLED"
    /// 含主机名解析不出的 URL——空主机名恒不命中受信集（fail-closed），归本类。
    case unverifiedDomain = "UNVERIFIED_DOMAIN"
    case acceleratorUnavailable = "ACCELERATOR_UNAVAILABLE"
}

/// 判定结局。放行时直接带上构造好的 URL，调用方无从自己拼错。
public enum FallbackDecision: Equatable, Sendable {
    case accelerate(url: String)
    case denied(reason: FallbackDenial)
}

public struct FetchPolicyInput: Sendable, Equatable {
    public let url: String
    public let failure: FetchFailureKind
    public let trustedSha256: Set<String>
    public let acceleratorBase: String

    public init(url: String, failure: FetchFailureKind, trustedSha256: Set<String>, acceleratorBase: String) {
        self.url = url
        self.failure = failure
        self.trustedSha256 = trustedSha256
        self.acceleratorBase = acceleratorBase
    }
}

public enum FetchPolicy {
    /// 按序判定，先命中先返回。
    ///
    /// `acceleratorBase` 为空串即「未配置」——加速代理是可选构建期注入，缺失是正常出厂形态。
    public static func decide(_ input: FetchPolicyInput) -> FallbackDecision {
        if input.failure == .http { return .denied(reason: .httpNoFallback) }
        if input.failure == .cancelled { return .denied(reason: .cancelled) }
        let host = UrlInfo.hostname(input.url)
        guard DomainVerify.verify(host, allowedSha256: input.trustedSha256) else {
            return .denied(reason: .unverifiedDomain)
        }
        guard !input.acceleratorBase.isEmpty else { return .denied(reason: .acceleratorUnavailable) }
        return .accelerate(url: acceleratedUrl(host: host, url: input.url, acceleratorBase: input.acceleratorBase))
    }

    /// 加速 URL = `<base>/<sha256(host)><path><?query>`。主机名只以哈希形态出现，绝不还原（域名保密）。
    /// 只在 host 已过域名验证后调用，故 host 必非空。
    private static func acceleratedUrl(host: String, url: String, acceleratorBase: String) -> String {
        var base = Substring(acceleratorBase)
        while base.hasSuffix("/") { base = base.dropLast() }
        return base + "/" + DomainVerify.sha256Hex(host) + UrlInfo.pathAndQuery(url)
    }
}
