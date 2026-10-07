package cloud.oneoh.oneboxn.core

import kotlin.math.floor
import kotlin.math.pow

/** 字节数的数值与单位两段（供大号数值 + 小号单位的排版使用）。 */
data class ByteParts(val value: String, val unit: String)

// 字节 / 速率格式化纯函数（Home 显示用）。二进制单位（1024），保留一位小数并去掉多余的 .0。
object TrafficFormat {
    private val UNITS = listOf("B", "KB", "MB", "GB", "TB", "PB")

    /** 拆分字节数为数值与单位，如 1536 -> ("1.5", "KB")。 */
    fun bytesParts(value: Long): ByteParts {
        require(value >= 0) { "traffic bytes must be non-negative: $value" }
        if (value < 1024) return ByteParts(value.toString(), UNITS[0])
        var size = value.toDouble()
        var unit = 0
        while (size >= 1024.0 && unit < UNITS.size - 1) {
            size /= 1024.0
            unit++
        }
        return ByteParts(oneDecimal(size), UNITS[unit])
    }

    /** 已传量借总量的单位，如 (27.2 MB, 66.5 MB) -> "27.2 / 66.5 MB"：进度行只读一个单位。 */
    fun bytesOfTotal(received: Long, total: Long): String {
        require(received >= 0) { "traffic bytes must be non-negative: $received" }
        val totalParts = bytesParts(total)
        val divisor = 1024.0.pow(UNITS.indexOf(totalParts.unit))
        return "${oneDecimal(received / divisor)} / ${totalParts.value} ${totalParts.unit}"
    }

    private fun oneDecimal(size: Double): String {
        // 显式半进位（值恒非负，等价「远离零」）：不能用 `round` —— 它平局取偶，而 Swift 的
        // `rounded()` 平局远离零，1280 字节（1.25 KB）两端会分别给出 1.2 / 1.3（golden 锁定）。
        val rounded = floor(size * 10.0 + 0.5) / 10.0
        return if (rounded % 1.0 == 0.0) rounded.toLong().toString() else rounded.toString()
    }

    /** 格式化字节数，如 1536 -> "1.5 KB"。 */
    fun bytes(value: Long): String = bytesParts(value).let { "${it.value} ${it.unit}" }

    /** 格式化速率，如 1536 -> "1.5 KB/s"。 */
    fun rate(bytesPerSecond: Long): String = "${bytes(bytesPerSecond)}/s"
}
