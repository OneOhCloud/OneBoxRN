import Foundation

// 执行记录持久化端口：core 只搬语义，字节落在哪归平台。
// 与 Android core/RefreshRecordStorage.kt 逐字对应；镜像 ProfileStorage / RuleStorage 的同一形状。
public protocol RefreshRecordStorage: AnyObject {
    /// 尚无存储 → nil（首次运行是正常输入，不是错误）。
    func load() -> Data?

    func save(_ bytes: Data)
}
