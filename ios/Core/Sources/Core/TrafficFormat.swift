import Foundation

/// 字节数的数值与单位两段（供大号数值 + 小号单位的排版使用）。
public struct ByteParts: Sendable, Equatable {
    public let value: String
    public let unit: String

    public init(value: String, unit: String) {
        self.value = value
        self.unit = unit
    }
}

// 字节 / 速率格式化纯函数（Home 显示用）。二进制单位（1024），保留一位小数并去掉多余的 .0。
// 与 Android core/TrafficFormat.kt 逐字对应，等价性由 golden `traffic-format.json` 裁判。
public enum TrafficFormat {
    private static let units = ["B", "KB", "MB", "GB", "TB", "PB"]

    /// 拆分字节数为数值与单位，如 1536 -> ("1.5", "KB")。
    public static func bytesParts(_ value: Int64) -> ByteParts {
        precondition(value >= 0, "traffic bytes must be non-negative: \(value)")
        if value < 1024 { return ByteParts(value: String(value), unit: units[0]) }
        var size = Double(value)
        var unit = 0
        while size >= 1024.0 && unit < units.count - 1 {
            size /= 1024.0
            unit += 1
        }
        return ByteParts(value: oneDecimal(size), unit: units[unit])
    }

    /// 已传量借总量的单位，如 (27.2 MB, 66.5 MB) -> "27.2 / 66.5 MB"：进度行只读一个单位。
    public static func bytesOfTotal(_ received: Int64, _ total: Int64) -> String {
        precondition(received >= 0, "traffic bytes must be non-negative: \(received)")
        let totalParts = bytesParts(total)
        let divisor = pow(1024.0, Double(units.firstIndex(of: totalParts.unit)!))
        return "\(oneDecimal(Double(received) / divisor)) / \(totalParts.value) \(totalParts.unit)"
    }

    private static func oneDecimal(_ size: Double) -> String {
        // 显式半进位（值恒非负，等价「远离零」）：不能用 `rounded()` —— 它平局远离零，而 Kotlin 的
        // `round` 平局取偶，1280 字节（1.25 KB）两端会分别给出 1.3 / 1.2（golden 锁定）。
        let rounded = (size * 10.0 + 0.5).rounded(.down) / 10.0
        if rounded == rounded.rounded(.towardZero) { return String(Int64(rounded)) }
        return String(rounded)
    }

    /// 格式化字节数，如 1536 -> "1.5 KB"。
    public static func bytes(_ value: Int64) -> String {
        let parts = bytesParts(value)
        return "\(parts.value) \(parts.unit)"
    }

    /// 格式化速率，如 1536 -> "1.5 KB/s"。
    public static func rate(_ bytesPerSecond: Int64) -> String { "\(bytes(bytesPerSecond))/s" }
}
