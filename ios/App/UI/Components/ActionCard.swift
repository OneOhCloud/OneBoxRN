import SwiftUI

// 操作卡：整卡只放「文字操作」行（`accent` 图标 + `accent` 标签），不带 chevron、不进子层。
struct ActionCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        // 内衬 + 卡面走同一个源（`insetCardSurface`）；`cardSurface` 里的 clip 挡住行的方角
        // 按下填充（见该方法注释）。
        .insetCardSurface()
    }
}

/// 操作卡里的一行。
///
/// **聚合成一个描述而不是几个并列参数**：标签与图标说的是同一行的同一件事。
struct ActionItem {
    let label: String
    let systemImage: String
}

/// 操作行：`28` 图标列 + `15` 标签，整条为 `accent`（「文字操作」形态）。
struct ActionRow: View {
    @Environment(\.isEnabled) private var isEnabled
    let item: ActionItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.medium) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: SettingsRowMetrics.iconColumn, alignment: .leading)
                Text(item.label)
                    .font(Theme.TypeScale.rowTitle)
                Spacer(minLength: 0)
            }
            // 禁用时退出强调色（换色对不压透明度）。
            .foregroundStyle(isEnabled ? Theme.accent : Theme.textSecondary)
            .padding(.horizontal, Theme.Spacing.large)
            .padding(.vertical, SettingsRowMetrics.verticalInset)
            .frame(minHeight: SettingsRowMetrics.minimumHeight)
            .contentShape(Rectangle())
        }
        // 同上：操作行也是卡内可点的行，按下要画整行填充。
        .buttonStyle(SettingsRowStyle())
    }
}
