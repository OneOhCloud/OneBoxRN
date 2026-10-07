import Foundation

// 固定模式日期/时间格式化器的唯一构造点（到期日、日志时刻、失败时刻）。
//
// 存在的理由：`DateFormatter` 不钉 locale 就跟随环境的**日历与数字字形**。同一个纪元秒在
// 伊朗（`en_IR` —— 本产品地区选择里明确支持的一项）格式化成 `1404-11-13`、泰国 `2569-02-02`、
// 沙特 `١٤٤٧-٠٨-١٤`，而 Android 三处格式化器都显式传 `Locale.US`，恒为公历 ASCII。
// 这些模式化输出的用途是「与另一端一致、能粘贴给人看、能与服务端下发的到期语义对齐」，
// 不是本地化阅读，故一律钉 `en_US_POSIX`。
//
// 只有 Apple 侧需要这个构造点：`SimpleDateFormat(pattern, locale)` 把 locale 摆在参数位上，
// 漏掉即编译不过风格的显眼；`DateFormatter` 的 locale 是可选的独立属性，漏掉悄无声息。
// 权威门禁 = `make check rule=locale`。
func fixedFormatDateFormatter(_ pattern: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = pattern
    return formatter
}
