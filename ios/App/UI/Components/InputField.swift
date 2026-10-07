import SwiftUI

// 统一输入组件（唯一实现）：
// plain TextField + 无描边填充容器。**页面禁止另起输入样式**——两份实现的容器色会分叉。
//
// 形态有三种，容器只有一个落点（`inputContainer`）：容器色、圆角、内边距、最小高同源；
// 差别只在容器里放什么、容器外还有没有 supporting 行。
// 聚焦永远有两个可见信号（容器色 + 标签字重；没有标签的形态，第二个信号落在放大镜 / 单位上），
// 错误永远有图标 + supporting text；
// 状态切换不改变容器尺寸；supporting 行恒占位避免布局跳动。
struct InputField: View {
    /// 输入形态。
    enum Form {
        /// 编辑框：标签在上，可带说明 / 错误。`ground` 由调用点声明、无默认值：
        /// 默认值会让新页面静默拿到错底。
        case editor(label: String, ground: InputGround)
        /// 度量框：数值在左、单位作尾随后缀在右，无可见标签——外层（弹层标题）已经说出它是什么，
        /// 框上再标一遍名字是重复。`name` 只给读屏。可带说明 / 错误，`ground` 同编辑框。
        case measure(name: String, unit: String, ground: InputGround)
        /// 搜索框：前置放大镜 + 有内容时清除；无标签也无 supporting 行。
        case search(clearLabel: String)
    }

    let form: Form
    @Binding var text: String
    var placeholder = ""
    var supporting: String?
    var error: String?
    var disabled = false
    var multiline = false
    /// 出现即聚焦：由用户一个明确动作（例如点铅笔）唤出的输入框，不该再要他点第二下。
    var autofocus = false

    @FocusState private var focused: Bool

    @ViewBuilder
    var body: some View {
        switch form {
        case let .editor(label, _):
            editor(label: label)
        case let .measure(name, unit, _):
            measure(name: name, unit: unit)
        case let .search(clearLabel):
            search(clearLabel: clearLabel)
        }
    }

    private func editor(label: String) -> some View {
        supported {
            VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                Text(label)
                    .font(Theme.TypeScale.subtitle)
                    .fontWeight(focused ? .semibold : .regular)
                    .foregroundStyle(labelColor)
                textField
            }
        }
    }

    private func measure(name: String, unit: String) -> some View {
        supported {
            HStack(spacing: Theme.Spacing.small) {
                textField
                    .accessibilityLabel(name)
                // 单位在本形态里担标签的角色，故聚焦的第二个信号（字重）落在它身上；
                // 字色恒为次要色、随容器升档：判据是**容器现在是不是 accentContainer**，不是「聚不聚焦」
                // ——错误态的底是 `errorContainer`（`textSecondary` 压它 `4.76` 达标），未聚焦是 `fill`（`4.75`）。
                Text(unit)
                    .font(Theme.TypeScale.status)
                    .fontWeight(focused ? .semibold : .regular)
                    .foregroundStyle(Theme.secondaryText(on: secondarySurface))
            }
        }
    }

    /// 编辑与度量两种形态共用：输入容器 + 恒占位的 supporting 行。
    private func supported(@ViewBuilder container: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
            container()
                .inputContainer(containerColor)
                // 禁用时整个输入容器压暗；禁用态在本件上没有第二条通道。
                .opacity(disabled ? InputFieldMetrics.disabledOpacity : 1)

            // supporting 行恒占位：错误态带警示图标，常态显示说明文案，两者切换不改变布局。
            if let error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(Theme.TypeScale.subtitle)
                    .foregroundStyle(Theme.error.fg)
            } else {
                Text(supporting ?? " ")
                    .font(Theme.TypeScale.subtitle)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityHidden(supporting == nil)
            }
        }
        .disabled(disabled)
        .colorTransition(focused)
        .colorTransition(error == nil)
    }

    private func search(clearLabel: String) -> some View {
        HStack(spacing: Theme.Spacing.small) {
            // 放大镜在搜索形态里担标签的角色，故聚焦的第二个信号落在它身上（前景转 `textPrimary`）：
            // 「聚焦永远有两个可见信号」是组件级不变式，没有标签的形态不能只剩容器色一个。
            Image(systemName: "magnifyingglass")
                .font(Theme.TypeScale.control)
                .foregroundStyle(labelColor)
            textField
                .plainTextInput()
                .submitLabel(.search)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(Theme.TypeScale.control)
                        .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(clearLabel)
            }
        }
        .inputContainer(containerColor)
        .colorTransition(focused)
    }

    private var textField: some View {
        // 多行输入内部的长文本滚动**保留滚动条**：它与文档
        // 视图同族，不因为宿主页面是版式页而改变判定。单行时控件内没有滚动区，无影响。
        TextField(placeholder, text: $text, axis: multiline ? .vertical : .horizontal)
            .textFieldStyle(.plain)
            .lineLimit(multiline ? 4...8 : 1...1)
            .focused($focused)
            .font(Theme.TypeScale.control)
            .foregroundStyle(Theme.textPrimary)
            .task { if autofocus { focused = true } }
    }

    /// 未聚焦态取脚下那一层之上的一层（见 `InputGround`）；搜索框恒坐在页面底上。
    private var containerColor: Color {
        if error != nil { return Theme.error.container }
        if focused { return Theme.accentContainer }
        switch form {
        case let .editor(_, ground), let .measure(_, _, ground): return ground.restContainer
        case .search: return InputGround.page.restContainer
        }
    }

    /// 次级文字（单位）此刻坐在哪个面上。**与 `containerColor` 同一套分支**——
    /// 两者分开写就会漂：容器换了色而字没跟着升档。
    private var secondarySurface: Theme.SecondaryTextSurface {
        containerColor == Theme.accentContainer ? .accentContainer : .plain
    }

    /// 聚焦态**不用 `accent`**：`accent` 压 `accentContainer` 明亮下只有 `4.57:1`、暗色下 `3.44:1` 不达标。
    /// 聚焦的双信号是**容器色 + 字重**（见上面的 `fontWeight`），字色不是第三个信号。
    private var labelColor: Color {
        if error != nil { return Theme.error.fg }
        if focused { return Theme.textPrimary }
        return Theme.textSecondary
    }
}

/// 输入框坐在什么上面（Android 同；与 `ProfileMarkGround` 同一张表）。
/// **入参是「面」，不是一个 `Bool`**：调用点回答「我压在什么上面」，容器取什么色只在这里决定。
enum InputGround {
    /// 页面底色上（搜索、配置改名）。
    case page
    /// `surface` 面上（弹层面板、卡片：导入 URL / 代理端口 / 规则批量值 / 引擎参数）。
    case surface

    /// 未聚焦的容器色：脚下那一层之上的一层。取同一层，聚焦之前输入框根本不存在；
    /// 页面底上取 `fill`，是一块比带晕染的页底更深、发脏的灰——取 `surface`，与卡片、dock 同族。
    /// `surface` 面上取 `fill`，与同一面上的次要按钮同族。
    var restContainer: Color {
        switch self {
        case .page: Theme.surface
        case .surface: Theme.fill
        }
    }
}

/// 输入容器的版式账。
enum InputFieldMetrics {
    /// 禁用：容器与内容整体降到这一档。
    /// **不并进 `ButtonMetrics.disabledOpacity`（`0.5`）**：输入框那一档要让**标签仍可辨认**，与「这件控件按不动」不是同一件事——值也确实不同。
    static let disabledOpacity: Double = 0.55
    static let horizontalInset: CGFloat = Theme.Spacing.medium
    /// `10` 不在间距档里：容器内衬由最小高与字号定，不参与页面的间距节奏。
    static let verticalInset: CGFloat = 10
    static let minHeight: CGFloat = 40
}

private extension View {
    /// 两种形态唯一的容器落点：`Radius.control`、内衬 `12 × 10`、最小高 `40`，
    /// **无描边、无 indicator、无下划线**。
    func inputContainer(_ color: Color) -> some View {
        padding(.horizontal, InputFieldMetrics.horizontalInset)
            .padding(.vertical, InputFieldMetrics.verticalInset)
            .frame(maxWidth: .infinity, minHeight: InputFieldMetrics.minHeight, alignment: .leading)
            .background(color, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
    }
}
