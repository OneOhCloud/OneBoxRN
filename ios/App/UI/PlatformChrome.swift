import SwiftUI

extension View {

    /// 弹层高度贴合内容：内容多高，弹层就多高，底部只留 `Theme.sheetBottomInset` 一档。
    /// 短表单型、不滚动的弹层用它；自己挑档位的可滚动弹层直接给 `presentationDetents`。
    ///
    /// 弹层高度只由 `presentationDetents` 决定，根视图收到的提案是解出的那个具体值。
    /// 短表单挑 `.medium` 就会在下沿空出一条与内容无关的带。
    /// 故量出内容理想高度再落成 `.height` detent。
    ///
    /// **不加 `safeAreaInsets.bottom`**：
    /// `.height(h)` 的 `h` 是**安全区内**的内容高，系统自己会再加底部安全区。
    /// 手工再加一次就是双重内衬。这条同时挡住了键盘：软键盘算在 SwiftUI 的安全区里，一旦把
    /// `safeAreaInsets.bottom` 并进 detent，用户点一下输入框弹层就会被顶到全屏。
    ///
    /// 不动点稳定的前提是**内容里不能有纵向贪婪视图**（`Spacer()`、`frame(maxHeight: .infinity)`）：
    /// 否则量到的是弹层高度而不是理想高，detent 会自锁在首档或逐帧抬高。加内容时守住这一条。
    func fittedSheetChrome() -> some View { modifier(FittedSheetChrome()) }

    /// 纯文本输入（不自动大写、不自动纠错）。
    func plainTextInput() -> some View {
        return textInputAutocapitalization(.never).autocorrectionDisabled()
    }

    /// 列表行的中立装饰（不画分隔线，靠背景分组划分区域）。
    ///
    /// **不出本文件**：调用方走 `fullWidthInteractiveListRow()`（它的行状态层把算好的填充传进 `fill:`）
    /// 或 `textListRow(inset:)`——一个要调用方猜的内缩数会把两种语义压成一个值。
    fileprivate func listRowChrome(horizontalInset: CGFloat, fill: Color = .clear) -> some View {
        // 不画分隔线。
        return listRowSeparator(.hidden)
            .listSectionSeparator(.hidden)
            // **全树唯一一处 `.listRowBackground`**：它**内层优先** —— 第二处会**静默吃掉**外面那一处，
            // 而两者在源码里都长得像生效了。
            .listRowBackground(fill)
            .listRowInsets(EdgeInsets(
                top: 0,
                leading: horizontalInset,
                bottom: 0,
                trailing: horizontalInset
            ))
    }

    /// **满幅状态填充的可点行**（规则、更新记录）：悬停 / 按下的底铺到**卡沿**，不是铺到行内容。
    ///
    /// 零额外内缩、行间零留白：**这里加多少内缩，高亮就窄多少 × 2**；这一类行同处一张卡，
    /// 行间留空会把卡断成一段段。故本入口不收参数，行内容离卡沿的内衬由行自己给。
    ///
    /// **填充不能挂在 `ButtonStyle` 的 `.background` 上**：那样它铺的是 **label 的边界**；
    /// **`listRowBackground` 铺的是 `List` 的整行** ⇒ 没有魔法数。
    ///
    /// **按下态也要一起搬**：只搬悬停会让两种状态铺不同的宽。
    func fullWidthInteractiveListRow() -> some View {
        modifier(FullWidthRowInteraction())
    }

    /// **非交互文本行，以及反馈自带圆角块的行**（配置查看、日志）。
    ///
    /// 内缩由调用方给：它是**内容内缩**，与状态反馈无关——日志行可点，但它的复制反馈是一块
    /// `Radius.control` 圆角块，形状不依赖行宽，
    /// 所以它是「交互行也可以不要满幅」的反例。**判准是状态反馈的形状依不依赖行宽，不是可不可点。**
    func textListRow(inset: CGFloat) -> some View {
        listRowChrome(horizontalInset: inset)
    }

    /// 滚动位置观察：签名只暴露中立的 `ScrollNearMetrics`，两处消费方（配置页回顶胶囊、
    /// 日志页自动滚底）不必各自认识 `ScrollGeometry` 全貌。
    func onScrollNear<T: Equatable>(
        _ type: T.Type,
        of transform: @escaping (ScrollNearMetrics) -> T,
        action: @escaping (T, T) -> Void
    ) -> some View {
        modifier(ScrollNearModifier(transform: transform, action: action))
    }
}

/// `fittedSheetChrome()` 的实现，理由与前提见该方法的注释。
private struct FittedSheetChrome: ViewModifier {
    /// 内容理想高（已含底部呼吸量）。0 = 还没量到，那一帧退回 `.medium`；
    /// 量高与呈现落在同一次布局里，故这一帧不可见。
    @State private var contentHeight: CGFloat = 0

    @ViewBuilder
    func body(content: Content) -> some View {
        content
            .padding(.bottom, Theme.sheetBottomInset)
            // 向上取整：量得值可能带小数，逐帧抖动会让 detent 反复重算并拖出动画。
            .onGeometryChange(for: CGFloat.self) { $0.size.height.rounded(.up) } action: {
                contentHeight = $0
            }
            .presentationDetents(contentHeight > 0 ? [.height(contentHeight)] : [.medium])
    }
}

/// 修饰符落在独立的 `ViewModifier` 里，不在 `onScrollNear` 里 `return AnyView(...)`：`AnyView` 抹掉结构标识，
/// SwiftUI 无从 diff 子树，于是被它包住的**整棵滚动列表**在父级每次更新时重建。日志页的父级随日志版本每 100 ms
/// 重求值一次，快速滚动时叠成洪峰。
private struct ScrollNearModifier<Value: Equatable>: ViewModifier {
    let transform: (ScrollNearMetrics) -> Value
    let action: (Value, Value) -> Void

    func body(content: Content) -> some View {
        content.onScrollGeometryChange(for: Value.self) { geometry in
            transform(ScrollNearMetrics(
                offsetY: geometry.contentOffset.y,
                containerHeight: geometry.containerSize.height,
                contentHeight: geometry.contentSize.height
            ))
        } action: { old, new in
            action(old, new)
        }
    }
}

/// 运行平台的自陈（关于页「系统信息」卡的「操作系统」行）。
enum PlatformIdentity {
    static var osDisplayName: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        var text = "\(version.majorVersion).\(version.minorVersion)"
        if version.patchVersion > 0 { text += ".\(version.patchVersion)" }
        return "iOS \(text)"
    }
}

/// 滚动观察所需的中立度量：只取两处消费方实际用到的三个量，不复刻 `ScrollGeometry` 全貌。
struct ScrollNearMetrics {
    let offsetY: CGFloat
    let containerHeight: CGFloat
    let contentHeight: CGFloat
}

/// **占位但不可见**：保留布局尺寸，同时让这一份内容退出交互与读屏。
///
/// 用 `opacity` 而非 `if`：后者会把它移出布局，槽位尺寸随状态变化，其下内容随之上跳下落。
/// **不可见的那一份必须同时退出三条路**——不可点、不入读屏、不进键盘焦点序。
/// 只关前两条会留下一个看不见的 Tab 停靠点，Tab 落上去、Enter 就能触发它。
///
/// **住在这里而不是某一屏里**：它是「隐藏」这件事的唯一正确写法。
/// 恒定槽位里那一格此刻**显示**还是**隐藏但占位**。
///
/// **不用 `Bool`**：`visible: false` 在调用点读起来是「不可见」，**读不出「但它仍然占着位置」**——
/// 而后者正是这个修饰符存在的全部理由。两个具名分支各自把话说完。
enum SlotVisibility {
    case shown
    /// 看不见，但**尺寸照旧**；同时退出可点 / 读屏 / 键盘焦点序三条路。
    case hiddenKeepingSpace

    fileprivate var isShown: Bool { self == .shown }
}

extension View {
    func keepingSpace(_ visibility: SlotVisibility) -> some View {
        let shown = visibility.isShown
        return opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
            .disabled(!shown)
    }
}

/// 弹层里内容自己的标题。
///
/// **留白与对齐挂在调用点**：各调用点的标题留白各不相同，故这里不烘任何留白进去。
struct ContentModalHeading: View {
    let text: String
    /// 默认是弹层标题的那一档（`sheetTitle` = `16/600`）。
    /// 更新记录详情传的是 `15/600`（`rowTitle.weight(.semibold)`），依据是 UI 参考实现的详情弹层标题。
    var font: Theme.TypeStyle = Theme.TypeScale.sheetTitle

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(Theme.textPrimary)
    }
}

/// 弹层的标题条外壳：在内容上方自绘标题条与关闭键。
///
/// 与 `ContentModalHeading` 的分工：那个只给一行标题，关闭交给内容底部的按钮；
/// 这个把关闭键挂在标题条上，内容里不再另放关闭按钮。
struct ContentModalTitleBar<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            content
        }
        .background(Theme.background)
    }

    /// 标题条 `44` 高，右上角 `28` 圆形关闭键。标题条下**不画边线**。
    ///
    /// **字重 `15/600`**：取 `rowTitle.weight(.semibold)`，在调用点组合，不新加令牌——
    /// `rowTitleEmphasis`（`500`）的消费方全是数值读数，`500` 对它们是对的。
    private var titleBar: some View {
        ZStack {
            Text(title)
                .font(Theme.TypeScale.rowTitle.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        // 弹层关闭键的图标字形 `18`（圆的直径是 `28`）。
                        // **与行图标槽那个 `22` 是两个角色两个值，不许互相「统一」。**
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: ContentModalTitleBarMetrics.closeSide,
                               height: ContentModalTitleBarMetrics.closeSide)
                        .background(Theme.fill, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tr("failure_dismiss"))
            }
            .padding(.horizontal, Theme.Spacing.large)
        }
        .frame(height: ContentModalTitleBarMetrics.height)
    }
}

enum ContentModalTitleBarMetrics {
    static let height: CGFloat = 44
    static let closeSide: CGFloat = 28
}

/// `fullWidthInteractiveListRow` 的状态层：悬停与按下都在**行**这一级，填充交给 `listRowBackground`。
private struct FullWidthRowInteraction: ViewModifier {
    @State private var hovering = false
    @State private var pressed = false

    /// **填充经 `listRowChrome(fill:)` 传进去，不在外面叠第二个 `.listRowBackground`** ——
    /// 那个修饰符**内层优先**，叠在外面的**从不生效**，而源码里两者都长得像生效了。
    func body(content: Content) -> some View {
        content
            .buttonStyle(RowStatePipe(pressed: $pressed))
            .onHover { hovering = $0 }
            .listRowChrome(horizontalInset: 0,
                           fill: RowInteraction(hovering: hovering, pressed: pressed).fill)
            .animation(.default, value: hovering)
    }
}

/// 只把 `isPressed` 送出来的 `ButtonStyle`。**它自己不画任何东西** ——
/// 画在这里就又回到「铺 label 边界」那个问题上了。
private struct RowStatePipe: ButtonStyle {
    @Binding var pressed: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .onChange(of: configuration.isPressed) { _, now in pressed = now }
    }
}
