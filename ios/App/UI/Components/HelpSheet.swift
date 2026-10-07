import SwiftUI

/// 一个说明块：标题 + 正文。
struct HelpBlock: Identifiable {
    let title: String
    let body: String

    var id: String { title }
}

/// 帮助弹层。
///
/// 三屏的帮助弹层**逐项同构**——同一种控件、同一种块，用户在几处看到的是同一个东西，
/// 故三屏共用这一份；差的只有标题与说明块的内容。
/// 另一端的对应件：`android/…/ui/components/HelpSheet.kt`。
///
/// **内衬的两档不要混**：面板内衬 `SheetInset.panel` 只约束**带底色的块**；
/// 纯文本行（标题、按钮）在它之外再各自内缩 `SheetInset.textExtra`，与块里的文字对齐；
/// 说明块若也按文字边线缩进，块边就会比标题更靠里。
struct HelpSheet: View {
    let title: String
    let blocks: [HelpBlock]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.large) {
                // 标题条不画下边线：它与下面的块之间只靠间距分开。
                ContentModalHeading(text: title)
                    .padding(.horizontal, SheetInset.textExtra)
                    // **居中**（标题 `16/600` 居中）。对齐挂在调用点而不是烘进 `ContentModalHeading`：
                    // **居中不是通则**——任务型页面的标题按阅读方向起始边对齐。
                    .frame(maxWidth: .infinity, alignment: .center)
                ForEach(blocks) { HelpBlockView(block: $0) }
                // 只有一个动作时不摆两颗并排按钮凑对称，单颗居中。
                Button(tr("failure_dismiss")) { dismiss() }
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, SheetInset.panel)
            .padding(.top, Theme.Spacing.large)
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
    }
}

/// 一张 `surface` 说明块：`Radius.control`，内边距 `12 × 10`。
///
/// **不调 `cardSurface()`**：那一档是分组卡（`Radius.card` `14`），
/// 而本块是弹层里带底色的块，与其余弹层块同取 `Radius.control`。
private struct HelpBlockView: View {
    /// 块的上下内衬。间距阶梯管的是「页面节奏」，**控件自己的内衬不归它管**，
    /// 故这个 `10` 不去吸附到 `8` 或 `12`；Android 同样写 `10`。
    private static let verticalInset: CGFloat = 10

    let block: HelpBlock

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
            Text(block.title)
                .font(Theme.TypeScale.blockTitle)
                .foregroundStyle(Theme.textPrimary)
            Text(block.body)
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Spacing.medium)
        .padding(.vertical, Self.verticalInset)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
    }
}
