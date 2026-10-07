// 隧道控制端口：导入流水线对隧道的全部依赖；
// 合并配置装配（active profile + 模式 + 规则）归实现，core 不触碰细节。
// 与 Android core/TunnelControl.kt 逐字对应。

public protocol TunnelControl {
    /// 停到 OS 确认断开；实现持有 10s 上限，超时或异常结局均正常返回不抛。
    func stop() async

    /// 用「active profile + 模式 + 规则」合并配置启动；失败或超时（实现持有 20s 上限）抛出。
    func start() async throws
}
