package cloud.oneoh.oneboxn.core

/**
 * 观察通道健康度。
 *
 * 一个值同时服务两处：呈现层据 [stalled] 决定显不显数字，开发者页据全部三项回答
 * 「通道还活着吗」——通道死掉时，应用内别无途径看出来
 * （统计页照常画旧数字、日志页停在最后一行、连接态显示已连接）。
 *
 * 与 iOS Core/ObservationHealth.swift 逐字对应。
 */
data class ObservationHealth(
    val endpoint: Endpoint,
    /** 通道自报的断流态：由通道层主动推，不是消费方按当前时间算出来的。 */
    val stalled: Boolean,
    /** 本次会话的通道重建次数：稳态恒为 0，非 0 即说明这条通道断过。 */
    val rebuildCount: Int,
) {
    init {
        require(rebuildCount >= 0) { "rebuild count must be non-negative: $rebuildCount" }
    }

    /** 端点当前归谁。 */
    enum class Endpoint {
        /** 尚未建立：未连接，或建通道失败且还在退避等待。 */
        ABSENT,

        /** 本实例持有并已绑定。 */
        BOUND,

        /** 被另一个活实例占用（Apple 侧特有形态）。 */
        BUSY;

        /** 小写 token（诊断呈现用）。 */
        val token: String get() = name.lowercase()
    }

    fun withEndpoint(endpoint: Endpoint): ObservationHealth = copy(endpoint = endpoint)

    fun withStalled(stalled: Boolean): ObservationHealth = copy(stalled = stalled)

    /** 重建计数只增不减：它记的是「本次会话断过几次」，不是「当前是不是断的」。 */
    fun countingRebuild(): ObservationHealth = copy(rebuildCount = rebuildCount + 1)

    companion object {
        val IDLE = ObservationHealth(endpoint = Endpoint.ABSENT, stalled = false, rebuildCount = 0)
    }
}
