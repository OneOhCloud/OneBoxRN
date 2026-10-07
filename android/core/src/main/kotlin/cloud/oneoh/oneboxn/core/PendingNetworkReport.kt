package cloud.oneoh.oneboxn.core

/**
 * 宿主向引擎上报网络变化的待办：上报在单线程执行器上排队执行，排队期间到达的变化并进同一次，
 * 执行时读最新状态。
 *
 * networkChanged 会关掉全部活连接，只有默认网络换了、或 start / reload 完成后要求整份补报时才
 * 重置；同一张网络的属性抖动只让引擎重读快照。重置意图由执行的那一次消费：已经执行过的重置
 * 不会被随后的补报再做一遍，否则第二次重置会关掉第一次之后刚建的连接。
 *
 * 不做同步，调用方持锁。`N` 是平台的网络标识，只比相等。
 */
class PendingNetworkReport<N : Any> {

    enum class Report { NETWORK_CHANGED, NETWORK_LOST, PROPERTIES_CHANGED }

    /** 当前默认网络；null = 没有可用的默认网络。 */
    var current: N? = null
        private set

    private var resetPending = false
    private var queued = false

    /** 默认网络可用。同一张网络再报可用不算切换，返回 false，不需要上报。 */
    fun available(network: N): Boolean {
        if (current == network) return false
        current = network
        resetPending = true
        return true
    }

    /** 某张网络丢了。丢的不是当前默认网络时返回 false：默认网络仍可用，不该挡住探测。 */
    fun lost(network: N): Boolean {
        if (current != network) return false
        current = null
        return true
    }

    fun isCurrent(network: N): Boolean = current == network

    /**
     * start / reload 完成后补报整份当前状态：有网重置、无网报丢失。转换期间的上报被引擎拒收过，
     * 而本侧状态已经前移，不补这一次就要等下一次网络变化才纠正。
     */
    fun requestFullReport() {
        resetPending = true
    }

    /** 占一个排队名额。已有一次在排队就并进去，返回 false。 */
    fun enqueue(): Boolean {
        if (queued) return false
        queued = true
        return true
    }

    /** 执行排队的那一次：让出名额，读最新状态，消费重置意图。 */
    fun take(): Report {
        queued = false
        val reset = resetPending
        resetPending = false
        return when {
            current == null -> Report.NETWORK_LOST
            reset -> Report.NETWORK_CHANGED
            else -> Report.PROPERTIES_CHANGED
        }
    }

    /** 监视器注销：之后注册的监视器会重新报出当前网络。 */
    fun forgetNetwork() {
        current = null
    }
}
