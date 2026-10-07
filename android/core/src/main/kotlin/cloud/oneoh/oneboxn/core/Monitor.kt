package cloud.oneoh.oneboxn.core

// 引擎契约（UI 进程侧）：只读观察 + 运行时命令。

interface Monitor {
    fun setHandler(handler: MonitorHandler)
    /** 同步取当前状态（挂载兜底，等价 getStatus）。 */
    fun currentStatus(): EngineStatus
    /** 读持久化的启动失败诊断（等价 getStartError）。 */
    fun lastError(): EngineError?
    fun selectNode(tag: String)
    fun urlTest(tag: String)
    /** 仅解绑观察者（断广播/命令通道），不请求内核停止；之后保证不再有回调。切核时用此路径，
     *  内核停止由 applyConfigurationChange 单点驱动，避免抢先 stop 竞态。 */
    fun detachHandler()
    /** 从 app 侧请求停止（含 detachHandler）；close 之后保证不再有任何回调。 */
    fun close()
}

/**
 * 回调可能在任意后台线程投递（上游命令客户端的后台读循环）。
 * 挂载时首个 onStatus 即当前状态。消费方负责 marshal 到主线程。
 */
interface MonitorHandler {
    fun onStatus(status: EngineStatus)
    fun onTraffic(traffic: Traffic)
    fun onGroups(groups: List<NodeGroup>)
    fun onLog(line: LogLine)
    /** 批量传输入口；不支持批次的绑定仍可逐条投递，消费方可覆盖以一次写入缓冲。 */
    fun onLogs(lines: List<LogLine>) {
        lines.forEach(::onLog)
    }
    fun onError(error: EngineError)

    /**
     * 观察通道健康度变化。
     *
     * 断流态必须由通道层**主动推**，不能让消费方在读取处按当前时间自己算：两端的可观察状态
     * 都只在**值变化**时触发重算，而「时间流逝」不改变任何值——只在 getter 里比
     * `now - lastFrame`，帧停之后没有任何东西会促使界面重算，第 15 秒永远不会自己到来，
     * 页面就永远停在旧数字上。
     *
     * 缺省空实现：不产观察数据的绑定（默认核）不必为此改动——换核对消费方零改动。
     */
    fun onObservationHealth(health: ObservationHealth) {}
}
