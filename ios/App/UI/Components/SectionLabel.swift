import SwiftUI

/// 区段小标题（`11` 大写、字距 `sectionLabel`、`textSecondary`；放在卡外上方）。
///
/// **`isHeader` 挂在文本上，不挂在承载它的行/容器上**：读屏的「按标题跳转」转子靠这个特性找标题，
/// 而运行统计页的速率卡是「标题 + 右端窗口说明」的一行——挂在那一行上会把右端那句一起并进标题。
///
/// **留白不烘进来**：`SettingsGroup` 给它左右 `extraSmall`（对齐卡内文字），
/// 而 `StatsScreen` 的几处在卡内、不需要。被复用的件不替调用点决定留白。
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .modifier(SectionLabelAppearance())
            .accessibilityAddTraits(.isHeader)
    }
}

/// 区段小标题的**注记变体**：外观逐条相同，**不报标题语义**。
///
/// 唯一的消费方形态是「标题 + 右端注记」的一行（运行统计页网速卡的「最近 60 秒」，
/// 与内存区标题同档）：那句念成标题是噪音，
/// 而挂 `isHeader` 还会让读屏把它并进左边那个标题（本文件上方那条注释说的正是这件事）。
///
/// **做成具名变体而不是一个 `isHeader:` 开关**：布尔标志参数说明这个件做了不止一件事，
/// 而两者的差别恰恰只有无障碍这一维——把它写进名字，调用点读起来就是语义。
/// 另一端同判：Android `StatsScreen.kt` 明写「右侧注记不报」。
struct SectionAnnotation: View {
    let text: String

    var body: some View {
        Text(text).modifier(SectionLabelAppearance())
    }
}

/// 两个变体共用的外观。**分出来是为了那四个修饰符只存在一份**——
/// 建 `SectionLabel` 的直接原因就是它们曾被抄三份。
private struct SectionLabelAppearance: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(Theme.TypeScale.sectionLabel)
            .textCase(.uppercase)
            .foregroundStyle(Theme.textSecondary)
    }
}
