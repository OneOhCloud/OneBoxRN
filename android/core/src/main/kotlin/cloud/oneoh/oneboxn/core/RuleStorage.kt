package cloud.oneoh.oneboxn.core

// 持久化端口：纯核心只依赖字节读写，平台侧提供实现（镜像 ProfileStorage；Android 写 filesDir，iOS 写 App Group 容器）。
// 纯核心测试可注入假实现，无需真实 IO。
interface RuleStorage {
    /** 读全部持久化字节；无数据返回 null。 */
    fun load(): ByteArray?
    fun save(bytes: ByteArray)
}
