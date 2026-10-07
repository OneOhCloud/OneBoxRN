// 引擎契约（UI 进程侧）：只读观察 + 运行时命令。与 Android core/Monitor.kt 逐字对应。

public protocol Monitor {
    func setHandler(_ handler: MonitorHandler)
    /// 同步取当前状态（挂载兜底，等价 getStatus）。
    func currentStatus() -> EngineStatus
    /// 读持久化的启动失败诊断（等价 getStartError）。
    /// - Throws: 诊断所在处此刻不可达：
    ///   读取没有发生，结局未知——不是「没有失败」，也不是一次启动失败。
    func lastError() throws -> EngineError?
    func selectNode(tag: String)
    func urlTest(tag: String)
    /// 只解绑观察，不停内核。切核时用它让出旧绑定——close 会连带停服务，
    /// 拿它当解绑会把正在跑的隧道一起停掉。
    func detachHandler()
    /// 从 app 侧请求停止；close 之后保证不再有任何回调。
    func close()
}

/// 回调可能在任意后台线程投递（上游命令客户端的后台读循环）。
/// 挂载时首个 onStatus 即当前状态。消费方负责 marshal 到主线程。
/// 方法声明 nonisolated：消费方（如 TunnelClient）在其内部 hop 到 MainActor 再改状态。
public protocol MonitorHandler: AnyObject, Sendable {
    func onStatus(_ status: EngineStatus)
    func onTraffic(_ traffic: Traffic)
    func onGroups(_ groups: [NodeGroup])
    func onLog(_ line: LogLine)
    func onError(_ error: EngineError)
    /// 观察通道健康度变化。
    ///
    /// 断流态必须由通道层**主动推**，不能让消费方在读取处按当前时间自己算：两端的可观察状态
    /// 都只在**值变化**时触发重算，而「时间流逝」不改变任何值——只在 getter 里比
    /// `now - lastFrame`，帧停之后没有任何东西会促使界面重算，第 15 秒永远不会自己到来，
    /// 页面就永远停在旧数字上。
    ///
    /// 缺省空实现：不产观察数据的绑定（默认核）不必为此改动（换核对消费方零改动）。
    func onObservationHealth(_ health: ObservationHealth)
}

extension MonitorHandler {
    public func onObservationHealth(_ health: ObservationHealth) {}
}
