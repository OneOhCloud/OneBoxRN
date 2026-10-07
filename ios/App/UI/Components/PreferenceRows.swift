import SwiftUI

// 分组卡内的行。
//
// 统一骨架：`28` 图标列（字形与主标题同一字阶）→ 主标题 `15` + 副标题 `12`（可选）→ 右侧值 `13` → 尾部图标 `13`。
// 行内边距 `16 × 12`，最小高 `52`，整行可点；悬停 / 按下整行填充，`120ms`。
//
// 右侧尾部图标两分语义：`chevron.right` = 推入下一页，`arrow.up.right` = 外跳系统浏览器；
// 取值行的尾部是系统弹出式按钮，上下箭头由系统自带。开关行不带 chevron——开关自身即控件，再加箭头会暗示还有下一层。

/// 取值行：行尾是系统的弹出式按钮（pop-up button），就地列出几个互斥取值、选中即持久化。
/// 设置页的路由模式 / 区域 / 内核行与参数页的缺省来源行是同一种交互。
///
/// 按钮显示当前值，点开是系统选单、勾出当前项，键盘、读屏与各端形态由系统给；
/// 暂不开放的取值照常列出、不可选（禁用是取值本身的属性，不是行的状态）。
struct ChoiceRow<Option: Hashable>: View {
    let label: String
    /// **必填、不可选** —— 与 `NavRow` 同一条理由（见那里）。
    let systemImage: String
    /// 行图标的语义族。缺省同 `SettingsRowLabel`。
    var iconFamily: SettingsIconFamily = .informational
    let options: [(value: Option, label: String, enabled: Bool)]
    let selection: Option
    let onSelect: (Option) -> Void
    /// 见 `SettingsRowLabel.titleLineLimit`。
    var titleLineLimit = 1

    /// 无障碍字号下标签与按钮改竖排：并排时按钮会把标签挤到读不全（理由同 `SettingsRowLabel`）。
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            SettingsIconColumn(systemImage: systemImage, family: iconFamily)
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                    title
                    picker
                }
                Spacer(minLength: 0)
            } else {
                title
                Spacer(minLength: Theme.Spacing.small)
                picker
            }
        }
        .preferenceRowPadding()
    }

    private var title: some View {
        Text(label)
            .font(Theme.TypeScale.rowTitle)
            .foregroundStyle(Theme.textPrimary)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : titleLineLimit)
    }

    /// 系统 `Menu` 内嵌勾选式 `Picker`：弹出的仍是系统选单（勾出当前项、键盘与读屏照旧），
    /// 按钮标签由本行给——系统弹出式按钮的标签是正文字号且不接外部字号，比同卡其余行的取值大一档。
    private var picker: some View {
        Menu {
            Picker(label, selection: Binding(get: { selection }, set: { onSelect($0) })) {
                ForEach(options, id: \.value) { option in
                    Text(option.label)
                        .tag(option.value)
                        .selectionDisabled(!option.enabled)
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: Theme.Spacing.extraSmall) {
                Text(currentLabel)
                    .font(Theme.TypeScale.status)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                // 箭头只是「点开有选单」的外观，不进读屏。
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Theme.textSecondary)
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        // 箭头已画在标签里，不要系统再挂一个。
        .menuIndicator(.hidden)
        // 名字是这一行问的是什么，值是当前答案；否则名字与值都是当前取值，读不出是哪一项设置。
        .accessibilityLabel(label)
        .accessibilityValue(currentLabel)
        .sensoryFeedback(.selection, trigger: selection)
    }

    private var currentLabel: String {
        options.first { $0.value == selection }?.label ?? ""
    }
}

/// 导航行：点按推入下一页。
struct NavRow: View {
    let label: String
    /// **必填、不可选**：可选会让**「忘了给」与「有意不给」在源码里长得一样**。
    /// 依据是参考实现的组件契约：`OneBox/src/components/settings/common.tsx` 的
    /// `SettingItemProps` 里 **`icon` 无 `?`** 而 `subTitle` 有 —— **图标必填，副标题可选**。
    /// 这条**不靠门禁靠类型**：编译器挡得住、不可绕过。它只挡得住走共用件的那一类，
    /// 手写 `Button + HStack` 的行绕得过去，故那一类要并回共用件，见 `SettingsRowLabel`。
    let systemImage: String
    /// 行图标的语义族。缺省同 `SettingsRowLabel`。
    var iconFamily: SettingsIconFamily = .informational
    var subtitle: String?
    var value: String?
    /// 见 `SettingsRowLabel.titleLineLimit`。
    var titleLineLimit = 1
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            SettingsRowLabel(
                label: label,
                systemImage: systemImage,
                iconFamily: iconFamily,
                subtitle: subtitle,
                value: value,
                trailingSystemImage: "chevron.right",
                titleLineLimit: titleLineLimit
            )
        }
        .buttonStyle(SettingsRowStyle())
    }
}

/// 外链行：点按外跳系统浏览器。
///
/// **本行图标不上族色**：外链行不是一个功能入口（参考实现里它们 `size 18` 且无色）。
/// 本仓的外链行落在关于页里（`AboutContent` 的官网 / 隐私两行）。
struct LinkRow: View {
    let label: String
    /// **必填、不可选** —— 与 `NavRow` 同一条理由。
    /// **「必填」与「不上色」是两件事**：本行的图标照给，只是族取 `.neutral`（见上）。
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            SettingsRowLabel(
                label: label,
                systemImage: systemImage,
                // **写死 `.neutral`，不开成参数**（`android` 的取向，理由成立所以照用）：
                // **不上色是「外链行」这个行别的属性**，开成参数就等于允许某一处的外链行上色。
                iconFamily: .neutral,
                value: nil,
                trailingSystemImage: "arrow.up.right"
            )
        }
        .buttonStyle(SettingsRowStyle())
    }
}

/// 开关行：行尾是系统开关，就地切换、即时生效。
///
/// 走不了 `SettingsRowLabel`：`Toggle` 要自己持有标签，开关才落在行尾、整行才是一个控件。
/// 标签的字阶与色对照它的主 / 副标题。
struct ToggleRow: View {
    let label: String
    /// **必填、不可选** —— 与 `NavRow` 同一条理由（见那里）。
    let systemImage: String
    /// 行图标的语义族。缺省同 `SettingsRowLabel`。
    var iconFamily: SettingsIconFamily = .informational
    var subtitle: String?
    let isOn: Bool
    let onToggle: (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { isOn }, set: { onToggle($0) })) {
            HStack(spacing: Theme.Spacing.medium) {
                SettingsIconColumn(systemImage: systemImage, family: iconFamily)
                VStack(alignment: .leading, spacing: SettingsRowMetrics.subtitleGap) {
                    Text(label)
                        .font(Theme.TypeScale.rowTitle)
                        .foregroundStyle(Theme.textPrimary)
                    if let subtitle {
                        Text(subtitle)
                            .font(Theme.TypeScale.subtitle)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                // 标签自己撑满行宽，开关才会落到行尾。
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        // 开关形态显式声明，不随平台默认样式漂。
        .toggleStyle(.switch)
        // 可及名显式只取标题：副文本读屏照旧读得到，并进名字只会让名字变长。
        .accessibilityLabel(label)
        .preferenceRowPadding()
    }
}

/// 设置页行图标的**语义族**。
///
/// **着色的判别式是「这一行属于哪一族」，不是「这是哪个图标」** —— 参考实现里
/// 同一个 `Globe` 一处带色一处不带。故这里是**族**，不是一个 `Color` 参数：
/// 传颜色会让人按图标挑色。
///
/// 参考的第三族（启动 / 电源 / 自动连接）不另立：本仓没有落在这一族的行。「不上色」是另一个值。
enum SettingsIconFamily {
    /// 网络 / 连接：路由模式 · 区域。
    case networking
    /// 信息 / 导航：路由规则 · 工具 · 诊断 · 高级设置 · 关于，以及工具页与诊断页的各行。
    case informational
    /// **不上色**。两类消费方：外链行（`LinkRow`：官网 / 隐私，不是功能入口），
    /// 以及关于页内部的只读事实行（参考的 `InfoRow` 根本没有图标列）。
    /// 名字与 Android 侧同词（`Neutral`）——两端共有的语义不各端自命名。
    case neutral

    var tint: Color {
        switch self {
        case .networking: return Theme.iconConnectivity
        case .informational: return Theme.accent
        case .neutral: return Theme.textSecondary
        }
    }
}

/// 设置行左侧那一列图标 —— **唯一的一份**：走不了 `SettingsRowLabel` 的行（`Toggle` / 两件尾部元素
/// 放不进它的槽位）也调它，字阶、色族、列宽只有这一处。
///
/// **`systemImage` 必填**：与 `NavRow` 同一条理由 —— 可选会让「忘了给」与「有意不给」
/// 在源码里长得一样。
struct SettingsIconColumn: View {
    let systemImage: String
    var family: SettingsIconFamily = .informational

    /// 禁用时图标一并退出强调色：高饱和色留在点不动的行上，比压透明度更糟。
    @Environment(\.isEnabled) private var isEnabled
    /// 列宽随字形按同一条动态字号曲线放大：字形变大而列宽不动，大字号下字形会越出列、压到标题上。
    @ScaledMetric(relativeTo: Theme.TypeScale.rowTitle.relativeTo)
    private var columnWidth: CGFloat = SettingsRowMetrics.iconColumn

    var body: some View {
        Image(systemName: systemImage)
            // 与行标题同一字阶（同系统 `Label`）：符号与文字同高，随动态字号一起缩放。
            .font(Theme.TypeScale.rowTitle)
            .foregroundStyle(isEnabled ? family.tint : Theme.textSecondary)
            .frame(width: columnWidth, alignment: .leading)
    }
}


/// 三种行共用的标签骨架。尾部图标不同，其余一个像素都不许分叉。
struct SettingsRowLabel: View {
    let label: String
    /// **这一层仍然可选，而那不是疏漏** —— 它是**骨架**，不是行别：
    /// `AboutContent` 的只读事实行走的就是「无图标列」那一档（参考的 `InfoRow` 没有图标列）。
    /// **必填那条收在行别上**（`NavRow` / `ChoiceRow` / `LinkRow`），不收在骨架上。
    var systemImage: String?
    /// 缺省 `.informational`：设置各页里这一族的行最多，**让少数派显式传**。
    var iconFamily: SettingsIconFamily = .informational
    var subtitle: String?
    var value: String?
    let trailingSystemImage: String
    /// 普通档标题的行数上限。缺省单行截尾；名字比值要紧的行（引擎参数）给 `2`：
    /// 那时值列贴合内容、不让位，标题先折行、两行仍放不下才截尾。
    var titleLineLimit = 1

    /// 无障碍字号下整行改竖排。见 `accessibleBody` 的注释。
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// 禁用态**换色对，不压透明度**：整层压 `a` 时
    /// `(a·L₁+0.05)/(a·L₂+0.05)` 必然趋近 `1`，系数不是那个自由度。
    /// **着色在这里而不在 `SettingsRowStyle`**：行内每个元素都自设 `foregroundStyle`，
    /// 挂在样式层的颜色会被逐个覆盖掉。
    @Environment(\.isEnabled) private var isEnabled

    @ViewBuilder
    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            accessibleBody
        } else {
            compactBody
        }
    }

    /// 普通档：左标签 / 右值，值单行不换。
    private var compactBody: some View {
        HStack(spacing: Theme.Spacing.medium) {
            iconColumn
            titleColumn
            Spacer(minLength: Theme.Spacing.small)
            if let value {
                Text(value)
                    .font(Theme.TypeScale.status)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .fixedSize(horizontal: titleLineLimit > 1, vertical: false)
            }
            trailingIcon
        }
        .preferenceRowPadding()
        .contentShape(Rectangle()) // 可点击区域覆盖整行
    }

    /// 无障碍档：**标签在上、值在下，两者都允许换行**。
    ///
    /// 为什么必须换形态而不是让值也换行：标签本来就允许换行，字号一大它占满整行宽，
    /// 单行的值被挤到没有位置——「路由模式」在 `AccessibilityL` 下显示成
    /// `Rules Routi…`，**用户读不到当前设置**。而两栏都换行会把行撑得很高，尾部 chevron
    /// 的对齐也失去基准。iOS 自家设置在无障碍字号下就是把值行竖过来，这里照搬。
    ///
    /// **判据取 `dynamicTypeSize.isAccessibilitySize`，不是宽度阈值**：宽度阈值在 iPad
    /// 上会给出意外结果，而这条要治的是字号不是窗口。普通档走另一支、零改动。
    /// **值的起始边对齐到标签，不是对齐到图标列**：竖排之后值是标签的从属项，
    /// 与图标齐会读成「图标 + 标签」之外并列的第三样东西。故值与标签同处一个 `VStack`，
    /// 图标在这个栈之外。
    ///
    /// **chevron 垂直居中于整行**：它指的是「这一行可以点进去」，指涉对象是整行。外层 `HStack`
    /// 默认就按整行居中，前提是没有别的子项把行撑高——图标因此改为满高顶对齐（跟第一行走，
    /// 与 iOS 自家设置同），而不是作为定高子项参与撑高。
    ///
    /// 图标那一层**必须保留「没有图标就整列不存在」**：`iconColumn` 缺席时
    /// 产出的是 `EmptyView`，HStack 连间距一起省掉；若套一层容器再顶对齐，无图标的行会凭空
    /// 多出一段缩进。故这里判空一次，只在有图标时才包那一层。
    private var accessibleBody: some View {
        HStack(spacing: Theme.Spacing.medium) {
            if systemImage != nil {
                iconColumn
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                titleColumn
                if let value {
                    Text(value)
                        .font(Theme.TypeScale.status)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Theme.Spacing.small)
            trailingIcon
        }
        .preferenceRowPadding()
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var iconColumn: some View {
        if let systemImage {
            SettingsIconColumn(systemImage: systemImage, family: iconFamily)
        }
    }

    /// **单行 + 尾部省略号，显式声明**：SwiftUI `Text` 的框架默认不是尾部省略，是换行。
    /// **无障碍档不在此列**：那一支两栏都允许换行（见 `accessibleBody`），行数上限由字号档决定。
    private var titleColumn: some View {
        // 无障碍档放开行数上限：这一支的全部理由就是「宁可行变高，也不要把字切掉」。
        let lineCap: Int? = dynamicTypeSize.isAccessibilitySize ? nil : titleLineLimit
        return VStack(alignment: .leading, spacing: SettingsRowMetrics.subtitleGap) {
            Text(label)
                .font(Theme.TypeScale.rowTitle)
                .foregroundStyle(isEnabled ? Theme.textPrimary : Theme.textSecondary)
                .lineLimit(lineCap)
                .truncationMode(.tail)
            if let subtitle {
                Text(subtitle)
                    .font(Theme.TypeScale.subtitle)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(lineCap)
                    .truncationMode(.tail)
            }
        }
    }

    private var trailingIcon: some View {
        Image(systemName: trailingSystemImage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
    }
}

/// 分组卡内一行的骨架度量。
/// **全仓唯一来源**：设置行、操作行、开发者页与引擎自陈页的行都读它——同一个骨架散成几份，
/// 就会出现同一张卡里开关行 `60`、导航行 `43` 这种不齐。
enum SettingsRowMetrics {
    /// 图标列在默认字号下的宽：各行同宽，标题起始边才对得齐。`SettingsIconColumn` 让它随行标题一起放大。
    static let iconColumn: CGFloat = 28
    static let minimumHeight: CGFloat = 52
    /// 主标题与副标题之间。
    static let subtitleGap: CGFloat = 2
    /// 行内边距的纵向一档（横向取 `Theme.Spacing.large`）：卡内主干行是 `16 × 12`。
    static let verticalInset: CGFloat = 12
}

/// 行的悬停 / 按下填充：分组卡内的行靠填充分开，不靠线。
/// **贴卡沿的那一类行**用它：状态层左右沿即卡沿，不自带圆角——给它加圆角是在卡沿上啃豁口。
///
/// **禁用态不在这一层画**：行内每个元素都自设 `foregroundStyle`，挂在这里的颜色会被逐个覆盖；
/// 而整层压透明度过不了正文对比度门槛。
/// 着色落在 `SettingsRowLabel` 与 `ActionRow` 各自的 `isEnabled` 分支上。
struct SettingsRowStyle: ButtonStyle {
    /// **只用来关掉悬停反馈，不用来上色**（上色会被行内各元素的 `foregroundStyle` 覆盖）。
    /// `.onHover` 不看 `isEnabled` ⇒ 不关的话，**点不动的行仍会在指针下亮起 `rowHover`**，
    /// 读起来就是「这一行可以点」。按下那一路本来就到不了（手势被 `.disabled` 挡住）。
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RowInteraction(hovering: isEnabled && isHovering,
                                       pressed: configuration.isPressed).fill)
            .onHover { isHovering = $0 }
            .animation(Theme.motion(Theme.Motion.rowHover), value: isHovering)
    }
}

extension View {
    /// 行内边距的唯一声明：分组卡各行同一节奏。
    func preferenceRowPadding() -> some View {
        padding(.horizontal, Theme.Spacing.large)
            .padding(.vertical, SettingsRowMetrics.verticalInset)
            .frame(maxWidth: .infinity, minHeight: SettingsRowMetrics.minimumHeight, alignment: .leading)
    }
}
