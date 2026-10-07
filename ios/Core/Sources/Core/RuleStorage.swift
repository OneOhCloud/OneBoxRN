import Foundation

// 持久化端口：纯核心只依赖字节读写，平台侧提供实现（镜像 ProfileStorage；Android 写 filesDir，iOS 写 App Group 容器）。
// 纯核心测试可注入假实现，无需真实 IO。与 Android core/RuleStorage.kt 逐字对应。
public protocol RuleStorage {
    /// 读全部持久化字节；无数据返回 nil。
    func load() -> Data?
    func save(_ bytes: Data)
}
