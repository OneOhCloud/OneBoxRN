package cloud.oneoh.oneboxn.core

// 执行记录持久化端口：core 只搬语义，字节落在哪归平台。
// 与 iOS Core/RefreshRecordStorage.swift 逐字对应；镜像 ProfileStorage / RuleStorage 的同一形状。
interface RefreshRecordStorage {
    /** 尚无存储 → null（首次运行是正常输入，不是错误）。 */
    fun load(): ByteArray?

    fun save(bytes: ByteArray)
}
