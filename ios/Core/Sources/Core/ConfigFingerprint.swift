import Foundation

/// 配置指纹（启动失败诊断用）：只由「长度 + djb2 哈希」组成，
/// 不含配置内容本身——用于回答「两次失败是不是同一份配置」，同时不泄露节点与域名。
///
/// 绝不用于校验或安全用途：djb2 是非加密哈希。
/// 与 Android core/ConfigFingerprint.kt 逐字对应。
public enum ConfigFingerprint {

    /// 空配置无指纹可言（调用方据此显示占位）。
    public static func of(_ config: String) -> String? {
        if config.isEmpty { return nil }
        return "len=\(config.utf16.count) djb2=#\(djb2(config))"
    }

    // 逐 UTF-16 码元迭代 + 32 位回绕，是两端逐字节同值的前提（Kotlin 侧同形）。
    private static func djb2(_ input: String) -> String {
        var hash: UInt32 = 5381
        for unit in input.utf16 {
            hash = (hash << 5) &+ hash &+ UInt32(unit)
        }
        return String(hash, radix: 36)
    }
}
