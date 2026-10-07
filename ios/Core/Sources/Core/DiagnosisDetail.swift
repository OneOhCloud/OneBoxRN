import Foundation

/// 失败详情的多段结构与树形投影。
///
/// **段与段之间用换行，不用 `—`**：`—` 也会出现在段内（「engine start timed
/// out after 20s — the app stopped waiting…」本身就带一个），读的人分不出哪一处是层级；
/// 呈现侧想画成树就只能去猜分隔符，而猜出来的层级会随文案改动悄悄错位。换行是显式的，
/// 且 join 与 split 同住一处——两侧各写一份迟早分叉，分叉只在失败那一拍现形。
///
/// 段的次序即读法：**首段是结局**（宿主确知的那句），其余各段是它的旁证，由近及远。
public enum DiagnosisDetail {
    /// 段分隔符。呈现与复制两侧都按它切，不得另立第二个约定。
    public static let separator = "\n"

    /// 合成：空段与纯空白段一律丢弃，不产出空行（空行在复制文本里读起来像诊断被截断了）。
    public static func join(_ parts: [String?]) -> String {
        parts
            .compactMap { $0 }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: separator)
    }

    /// 切分。对单段详情恒返回单元素数组——调用方不必为「有没有分段」写两条路径。
    public static func parts(_ detail: String) -> [String] {
        detail
            .components(separatedBy: separator)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// 树形投影（读法同崩溃栈）：首段顶格，其余各段挂在它下面，最后一段用 `└─`。
    ///
    /// 放在 core 而不是各端 UI 各画一份：两端画出来的形状必须一致，否则「同一次失败」
    /// 在两端读起来是两件事；而这是纯字符串逻辑，可被夹具逐字裁。
    public static func tree(_ detail: String) -> String {
        let all = parts(detail)
        guard let head = all.first else { return "" }
        let rest = Array(all.dropFirst())
        guard !rest.isEmpty else { return head }
        let branches = rest.enumerated().map { index, part in
            (index == rest.count - 1 ? "└─ " : "├─ ") + part
        }
        return ([head] + branches).joined(separator: "\n")
    }
}
