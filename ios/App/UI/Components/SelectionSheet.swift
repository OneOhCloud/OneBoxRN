import SwiftUI

/// 从一组取值里选一个的弹层。首页的配置与节点、设置页与引擎参数页的取值行共用这一件。
///
/// **选中即生效并收起，不设「确定」**：换配置、换节点、换路由模式都是可反悔的低风险操作，
/// 多一步确认只会把「随手换一个」变成一次小型表单。
///
/// **弹层多高由条目数决定，调用方不挑**：条目少时按内容求高，一眼看完；
/// 条目多时（节点动辄几十个）给半屏 / 全屏两档并可滚动，半屏看得见当前选中项的上下文，
/// 全屏翻长列表。两种形态的界线只有 `SelectionSheetMetrics.fittedRowLimit` 一处。
struct SelectionSheet<Value: Hashable, Row: View>: View {
    let title: String
    /// 标题旁的条目数徽章。只给会长到需要知道「一共多少」的列表（配置、节点）；
    /// 两三项的取值行一眼数得清，徽章只是噪音。
    var count: Int?
    let options: [Value]
    let selection: Value?
    /// 某一项此刻可不可选。**禁用是取值本身的属性**：点不了的项照常列出、置灰，
    /// 让用户知道它存在（区域里暂不开放的那几个就是这一类）。
    var isEnabled: (Value) -> Bool = { _ in true }
    let onSelect: (Value) -> Void
    /// 选项行主体：调用方自绘（配置给名字 + 元信息，节点给名字 + 延迟区，取值行给一行文字）。
    @ViewBuilder let row: (Value) -> Row

    @Environment(\.dismiss) private var dismiss

    @ViewBuilder
    var body: some View {
        if options.count > SelectionSheetMetrics.fittedRowLimit {
            ScrollView { content }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.surface)
        } else {
            content
                .fittedSheetChrome()
                .presentationBackground(Theme.surface)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            header
                .padding(.horizontal, SheetInset.textExtra)
                .padding(.top, Theme.Spacing.extraLarge)
                .padding(.bottom, Theme.Spacing.small)
            LazyVStack(spacing: SelectionSheetMetrics.rowGap) {
                ForEach(options, id: \.self) { option in
                    optionRow(option)
                }
            }
        }
        .padding(.horizontal, SheetInset.panel)
        .sensoryFeedback(.selection, trigger: selection)
    }

    private var header: some View {
        HStack(spacing: Theme.Spacing.small) {
            Text(title)
                .font(Theme.TypeScale.pageTitle)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let count {
                Text(String(count))
                    .font(Theme.TypeScale.statusEmphasis.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.Spacing.small)
                    .padding(.vertical, 2)
                    .background(Theme.fill, in: Capsule())
            }
        }
    }

    private func optionRow(_ option: Value) -> some View {
        SelectionOptionRow(isSelected: option == selection) {
            onSelect(option)
            dismiss()
        } content: {
            row(option)
        }
        .disabled(!isEnabled(option))
    }
}

/// 单选行：选中行恒带勾，未选中的勾照样占位。选择弹层与弹层表单里的单选组共用这一件；
/// 选中之后做什么（收起弹层，还是只记下草稿）由调用方的动作决定。
struct SelectionOptionRow<Content: View>: View {
    let isSelected: Bool
    let action: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.medium) {
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    // 勾恒占位（行宽不随选中态跳），未选中的那一份退出交互与读屏。
                    .keepingSpace(isSelected ? .shown : .hiddenKeepingSpace)
            }
            .padding(.horizontal, SheetInset.textExtra)
            .padding(.vertical, Theme.Spacing.medium)
            .frame(minHeight: SelectionSheetMetrics.rowMinimumHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(SelectionRowStyle(isSelected: isSelected))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

enum SelectionSheetMetrics {
    /// 超过这么多项就改成半屏 / 全屏两档的滚动弹层；不超过则按内容求高。
    /// 取 `6`：六行加标题在最小的手机上仍不到半屏，再多就开始挤占上面的页面。
    static let fittedRowLimit = 6
    static let rowGap: CGFloat = 2
    /// 行的最小命中高度。
    static let rowMinimumHeight: CGFloat = 48
}

/// 选项行的底：选中行恒为 `accentContainer`，其余行靠悬停 / 按下的填充差异，不画描边。
/// 文字由调用方给 `textPrimary`——`accent` 压 `accentContainer` 只有 `3.27:1`。
private struct SelectionRowStyle: ButtonStyle {
    let isSelected: Bool
    @State private var isHovering = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                isSelected ? Theme.accentContainer : RowInteraction(hovering: isHovering, pressed: configuration.isPressed).fill,
                in: RoundedRectangle(cornerRadius: Theme.Radius.control)
            )
            // 禁用项整体压暗；自绘行拿不到系统的禁用外观。
            .opacity(isEnabled ? 1 : ButtonMetrics.disabledOpacity)
            // 禁用项不接悬停：点不动的行在指针下亮起来，读起来就是「这一行可以点」。
            .onHover { isHovering = isEnabled && $0 }
            .animation(Theme.motion(Theme.Motion.rowHover), value: isHovering)
    }
}
