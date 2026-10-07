import SwiftUI

// 容器内的零内容说明行（空态的第三种形态）。
//
// **触发条件是容器，不是成因**：承载它的容器放不下整屏空态（图标砖 64 + 标题 + 说明 + 可选主操作）
// —— 卡内列表行、弹层内区块。**容器放得下时必须走 `EmptyState`。**
// 成因不限：路由规则页与日志页都是筛选无匹配，两者同形。
//
// 名字本身在做判别：`Inline` 说的是**它在内容流里**，相对 `EmptyState` 的**整屏居中**。
// 若有人想把它用在一个放得下整屏空态的容器里，**这个名字会先别扭起来**。
//
// ## `verticalInset` **由容器定**，而判别式是「容器的高度取不取决于这一行」
//
// ```
// 容器**抱内容**（`maxHeight` 是上限不是定值）⇒ 这个内衬**直接决定用户看到的空容器有多大**
//                                            档取大了，空容器就是一个只装一行字的「大空盒」
// 容器**独立定尺**（填满可用区）              ⇒ 它只决定这一行周围的留白
//                                            `RulesScreen` 的卡与 `LogsScreen` 的列表属此类
//                                            （两者都 `.frame(maxHeight: .infinity)`）
// ```
//
// **`verticalInset` 不给默认值**：根本没有单一正确值，
// 给任何一档做默认，都会让「容器属于哪一类」这个必答题变成可以不答的题。
struct InlineEmptyNote: View {
    let text: String
    let verticalInset: CGFloat

    var body: some View {
        Text(text)
            .font(Theme.TypeScale.control)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, verticalInset)
    }
}
