package cloud.oneoh.oneboxn.core

// 配置抓取的回落判定：主 URL 这一跳失败后，判定能否改打加速代理，
// 以及加速 URL 长什么样。纯函数，无 IO——抓取壳按判定执行，记录面按同一份输入复算得同一结论。
// 与 iOS Core/FetchPolicy.swift 逐字对应，golden/fetch-policy.json 是行为裁判。

/** 主 URL 那一跳的失败类别。分类归抓取壳（平台异常 → 本词表）。 */
enum class FetchFailureKind {
    /** 传输层失败：超时 / DNS / TLS / 断网。唯一有回落资格的类别。 */
    NETWORK,

    /** 服务器作了应答但状态码非 2xx。 */
    HTTP,

    /** 调用方取消。 */
    CANCELLED,
}

/** 抓取实际走的路。 */
enum class FetchRoute {
    PRIMARY,
    ACCELERATED,
}

/** 不回落的理由。恰一个「回落」结局，故放行不在本词表内。 */
enum class FallbackDenial {
    /** 服务器可达且作了应答，换条路也是同一个答案。 */
    HTTP_NO_FALLBACK,
    CANCELLED,

    /** 含主机名解析不出的 URL——空主机名恒不命中受信集（fail-closed），归本类。 */
    UNVERIFIED_DOMAIN,
    ACCELERATOR_UNAVAILABLE,
}

/** 判定结局。放行时直接带上构造好的 URL，调用方无从自己拼错。 */
sealed interface FallbackDecision {
    data class Accelerate(val url: String) : FallbackDecision

    data class Denied(val reason: FallbackDenial) : FallbackDecision
}

data class FetchPolicyInput(
    val url: String,
    val failure: FetchFailureKind,
    val trustedSha256: Set<String>,
    val acceleratorBase: String,
)

object FetchPolicy {
    /**
     * 按序判定，先命中先返回。
     *
     * `acceleratorBase` 为空串即「未配置」——加速代理是可选构建期注入，缺失是正常出厂形态。
     */
    fun decide(input: FetchPolicyInput): FallbackDecision {
        if (input.failure == FetchFailureKind.HTTP) return FallbackDecision.Denied(FallbackDenial.HTTP_NO_FALLBACK)
        if (input.failure == FetchFailureKind.CANCELLED) return FallbackDecision.Denied(FallbackDenial.CANCELLED)
        val host = UrlInfo.hostname(input.url)
        if (!DomainVerify.verify(host, input.trustedSha256)) {
            return FallbackDecision.Denied(FallbackDenial.UNVERIFIED_DOMAIN)
        }
        if (input.acceleratorBase.isEmpty()) return FallbackDecision.Denied(FallbackDenial.ACCELERATOR_UNAVAILABLE)
        return FallbackDecision.Accelerate(acceleratedUrl(host, input.url, input.acceleratorBase))
    }

    /**
     * 加速 URL = `<base>/<sha256(host)><path><?query>`。主机名只以哈希形态出现，绝不还原（域名保密）。
     * 只在 host 已过域名验证后调用，故 host 必非空。
     */
    private fun acceleratedUrl(host: String, url: String, acceleratorBase: String): String =
        acceleratorBase.trimEnd('/') + "/" + DomainVerify.sha256Hex(host) + UrlInfo.pathAndQuery(url)
}
