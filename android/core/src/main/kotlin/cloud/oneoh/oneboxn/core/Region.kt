package cloud.oneoh.oneboxn.core

// 区域（设置页区域选择）：枚举与 token 双射，无第三态。
// 与 iOS Core/Region.swift 逐字对应；token 是持久化的稳定标识。
// 纯占位设置：可选与持久化已锁定，零运行时效果（不进配置合并、不触发重启）。
enum class Region(val token: String, val available: Boolean) {
    CN("cn", true),
    IR("ir", false),
    RU("ru", false);

    companion object {
        /** token↔枚举映射唯一实现：未知 token 即枚举穷尽破坏，崩溃暴露（fail-fast）。 */
        fun fromToken(token: String): Region =
            entries.firstOrNull { it.token == token }
                ?: error("unknown region token: $token")
    }
}
