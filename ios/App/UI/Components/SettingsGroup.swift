import SwiftUI

// 分组卡：单一 `surface` 容器承载全部行（行间无分隔线）。
// 可选的区段小标题放在卡外上方（`11` 大写）——设置页的卡**不带标题**
// （加了会让本页出现一串 `11` 大写块，与别的页节奏不一致），开发者页与引擎自陈页仍带。
struct SettingsGroup<Content: View>: View {
    let label: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label {
                SectionLabel(text: label)
                    .padding(.horizontal, Theme.Spacing.extraSmall)
            }
            VStack(spacing: 0) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // `cardSurface` 里那一步 `clipShape` 是**必须**的：行的悬停 / 按下填充是无圆角的
            // 整行矩形，只给卡片一个圆角背景挡不住它——四角会被方角填充啃掉，读起来就是一条
            // 直角边。
            .insetCardSurface()
        }
    }
}
