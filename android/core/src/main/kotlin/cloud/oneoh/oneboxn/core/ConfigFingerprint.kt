package cloud.oneoh.oneboxn.core

/**
 * 配置指纹（启动失败诊断用）：只由「长度 + djb2 哈希」组成，
 * 不含配置内容本身——用于回答「两次失败是不是同一份配置」，同时不泄露节点与域名。
 *
 * 绝不用于校验或安全用途：djb2 是非加密哈希。
 */
object ConfigFingerprint {

    /** 空配置无指纹可言（调用方据此显示占位）。 */
    fun of(config: String): String? {
        if (config.isEmpty()) return null
        return "len=${config.length} djb2=#${djb2(config)}"
    }

    // 逐 UTF-16 码元迭代 + 32 位回绕，是两端逐字节同值的前提（Swift 侧同形）。
    private fun djb2(input: String): String {
        var hash = 5381L
        for (unit in input) {
            hash = ((hash shl 5) + hash + unit.code) and 0xFFFFFFFFL
        }
        return hash.toString(36)
    }
}
