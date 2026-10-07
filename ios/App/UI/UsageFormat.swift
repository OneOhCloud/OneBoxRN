import Foundation

// 用量到期时刻的展示格式化（Home 摘要卡与导入成功卡共用，单一实现）。
// expire 为 Unix 纪元秒（解析器不换算）；≤0 表示无到期信息 → nil，
// 由调用方映射 usage_no_expiry 文案。
enum UsageFormat {
    private static let formatter = fixedFormatDateFormatter("yyyy-MM-dd")

    static func expiryDate(_ epochSeconds: Int64) -> String? {
        guard epochSeconds > 0 else { return nil }
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(epochSeconds)))
    }
}
