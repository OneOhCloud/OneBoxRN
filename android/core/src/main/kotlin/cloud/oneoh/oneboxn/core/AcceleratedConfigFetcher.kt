package cloud.oneoh.oneboxn.core

import kotlin.coroutines.cancellation.CancellationException

// 两跳抓取：主 URL 失败 → FetchPolicy 判定 → 命中则以加速 URL 再打一次。
// 装在 ConfigFetcher 端口上，故导入、手动刷新、后台自动更新三条路径共用同一实现，无分支。
// 与 iOS Core/AcceleratedConfigFetcher.swift 逐字对应。

/** 一次抓取走了哪条路、闸门怎么判的。纯观察面，不参与写回。 */
data class FetchAttempt(val route: FetchRoute, val denial: FallbackDenial?)

class AcceleratedConfigFetcher(
    private val direct: ConfigFetcher,
    private val trustedSha256: Set<String>,
    private val acceleratorBase: () -> String,
    private val forceFallback: () -> Boolean,
    /**
     * 每次 fetch 结束（含失败）恰调一次。
     *
     * 之所以能用回调而不是塞进返回值：任一时刻至多一个抓取在飞，
     * 调用方读到的必是自己那一次的结果。并发抓取会打破该前提，故「至多一个在飞」是硬要求。
     */
    private val onAttempt: (FetchAttempt) -> Unit,
) : ConfigFetcher {
    override suspend fun fetch(url: String, userAgent: String): FetchReply {
        var primaryReply: FetchReply? = null
        var primaryFailure: Exception? = null

        val failure = if (forceFallback()) {
            // 强制回落开关：主 URL 这一跳直接判为网络层失败，不实际发出；闸门照常。
            FetchFailureKind.NETWORK
        } else {
            try {
                val reply = direct.fetch(url, userAgent)
                if (reply.status in 200..299) {
                    onAttempt(FetchAttempt(FetchRoute.PRIMARY, null))
                    return reply
                }
                primaryReply = reply
                FetchFailureKind.HTTP
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (transport: Exception) {
                primaryFailure = transport
                FetchFailureKind.NETWORK
            }
        }

        return when (val decision = FetchPolicy.decide(FetchPolicyInput(url, failure, trustedSha256, acceleratorBase()))) {
            is FallbackDecision.Denied -> {
                onAttempt(FetchAttempt(FetchRoute.PRIMARY, decision.reason))
                primaryReply ?: throw (primaryFailure ?: forcedPrimaryUnavailable())
            }
            is FallbackDecision.Accelerate -> {
                onAttempt(FetchAttempt(FetchRoute.ACCELERATED, null))
                direct.fetch(decision.url, userAgent)
            }
        }
    }

    // 强制回落开关开着、闸门又不放行时，主 URL 从未真发出，没有平台异常可抛；
    // 造一个说明真实原因的领域异常，别把「没试过」伪装成「试了没通」。
    private fun forcedPrimaryUnavailable() =
        IllegalStateException("primary url skipped by force-fallback switch and fallback was denied")
}
