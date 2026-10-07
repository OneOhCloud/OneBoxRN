package cloud.oneoh.oneboxn.core

/**
 * UTF-8 编码长度的零拷贝计算：与 `toByteArray(Charsets.UTF_8).size` 逐字节等价，但不分配整份副本。
 * 只需长度、不需字节的资源上限校验用它——多兆字节配置文本每次校验都复制一整份是纯浪费。
 */
object Utf8Length {
    /**
     * 孤立代理项（无配对的高/低代理）与 JDK / ART 的编码器一致，按替换字符 `?` 的 1 字节计，
     * 而非 U+FFFD 的 3 字节；等价性由 `Utf8LengthTest` 对拍真实编码器锁定。
     */
    fun of(text: String): Long {
        var bytes = 0L
        var index = 0
        while (index < text.length) {
            val unit = text[index]
            when {
                unit.code < 0x80 -> {
                    bytes += 1
                    index += 1
                }
                unit.code < 0x800 -> {
                    bytes += 2
                    index += 1
                }
                isSurrogatePairAt(text, index) -> {
                    bytes += 4
                    index += 2
                }
                unit.isHighSurrogate() || unit.isLowSurrogate() -> {
                    bytes += 1
                    index += 1
                }
                else -> {
                    bytes += 3
                    index += 1
                }
            }
        }
        return bytes
    }

    private fun isSurrogatePairAt(text: String, index: Int): Boolean =
        text[index].isHighSurrogate() &&
            index + 1 < text.length &&
            text[index + 1].isLowSurrogate()
}
