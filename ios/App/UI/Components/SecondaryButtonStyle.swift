import SwiftUI

// 次操作按钮样式族。
//
// 都必须是 ButtonStyle，理由同 PrimaryButtonStyle。
//
// **禁止描边按钮**。按压反馈统一为 85% 透明（无缩放），与主按钮同。

/// 柔和填充的次操作：`fill` 填充 + `textPrimary` 文字（默认色对 `Theme.secondaryAction`），
/// 胶囊、贴合内容宽度、高 `40`、`14/500`。破坏性语义由调用方传错误色对。
/// 前景**不用 `accent`**：暗色下 `accent` 压 `fill` 只有 `3.50:1`。
struct SecondaryButtonStyle: ButtonStyle {
    var tone: Theme.Tone = Theme.secondaryAction

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(GlyphLabelStyle(text: Theme.TypeScale.controlEmphasis))
            .font(Theme.TypeScale.controlEmphasis)
            .padding(.horizontal, ButtonMetrics.hugHorizontalInset)
            .frame(minHeight: ButtonMetrics.height)
            .fixedSize()
            .foregroundStyle(tone.fg)
            .background(tone.container, in: Capsule())
            // 按下反馈，与主 / 弱按钮同一档。
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

/// 弱操作按钮：sheet 里的「取消」这类退出动作，与次操作同底同形，但更弱——
/// 容器同为 `fill`，前景不用 `textPrimary` 而用 `textSecondary`、字重也更轻（`14/400`）。
/// 层级只来自填充与排版，没有描边。
struct QuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(GlyphLabelStyle(text: Theme.TypeScale.control))
            .font(Theme.TypeScale.control)
            .padding(.horizontal, ButtonMetrics.hugHorizontalInset)
            .frame(minHeight: ButtonMetrics.height)
            .fixedSize()
            .foregroundStyle(Theme.textSecondary)
            .background(Theme.fill, in: Capsule())
            // 按下反馈，与主 / 次按钮同一档。
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

/// 柔和填充的胶囊：浮在内容上的单一控件（回顶 / 跟随底部）与状态化的小操作。
/// 宽度随内容 + 水平 `16`、高 `32`、`13/500`，`accentContainer` 填充 + `textPrimary` 文字
/// （默认色对 `Theme.secondaryActionOnAccent`）。
struct TonalCapsuleButtonStyle: ButtonStyle {
    var tone: Theme.Tone = Theme.secondaryActionOnAccent

    /// 禁用态换一对颜色（`fill` + `textSecondary`），理由同 `PrimaryButtonStyle`：压透明度读不出标签。
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(GlyphLabelStyle(text: TonalCapsuleText.style))
            .font(TonalCapsuleText.style)
            .padding(.horizontal, Theme.Spacing.large)
            .frame(minHeight: ButtonMetrics.capsuleHeight)
            .foregroundStyle(isEnabled ? tone.fg : Theme.textSecondary)
            .background(isEnabled ? tone.container : Theme.fill, in: Capsule())
            // 按下反馈，与主 / 次按钮同一档。
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

/// 胶囊文字那一档。
enum TonalCapsuleText {
    static let style = Theme.TypeScale.statusEmphasis
}

/// 按钮与胶囊里的图标与文字：图标在前，两者之间留 `small`；图标经 `TextHeightGlyph` 与文字等高、垂直居中。
struct GlyphLabelStyle: LabelStyle {
    let text: Theme.TypeStyle

    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.small) {
            configuration.icon.modifier(TextHeightGlyph(text: text))
            configuration.title
        }
    }
}

/// 图标与同字号汉字等高，与文字垂直居中。图标不在 `Label` 里（如排在文字之后）的地方直接挂它，
/// 并与文字按 `firstTextBaseline` 排。
///
/// SF Symbols 按基线对齐时，字形中线落在它自身字号的大写字高一半处，汉字中线也在那里；
/// 图标字号比文字小，基线对齐后中线偏低，故把图标再抬两者大写字高之差的一半。
struct TextHeightGlyph: ViewModifier {
    /// 苹方汉字字面高与字号之比。SF Symbols 的满高字形（圆圈类）墨迹高约等于点数，
    /// 故图标点数取「字号 × 本比值」，图标与同字号汉字等高。
    static let hanFaceRatio: CGFloat = 0.92

    private let weight: Font.Weight
    @ScaledMetric private var textSize: CGFloat

    init(text: Theme.TypeStyle) {
        weight = text.weight
        _textSize = ScaledMetric(wrappedValue: text.size, relativeTo: text.relativeTo)
    }

    func body(content: Content) -> some View {
        let glyphSize = textSize * Self.hanFaceRatio
        let lift = (Self.capHeight(textSize) - Self.capHeight(glyphSize)) / 2
        content
            .font(.system(size: glyphSize, weight: weight))
            .alignmentGuide(.firstTextBaseline) { $0[.firstTextBaseline] + lift }
    }

    private static func capHeight(_ size: CGFloat) -> CGFloat {
        UIFont.systemFont(ofSize: size).capHeight
    }
}

/// 自带外观的入口（图标、图标砖）：样式不铺底、不改形，按下只压透明度。
struct PressDimmingButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}
