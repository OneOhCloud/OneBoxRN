import SwiftUI

/// 「行高 = 字号 × 倍数」在 SwiftUI 上的**唯一实现**。
///
/// 两个角色各有一个行高倍数：
///
/// ```
/// 文本块  配置查看的正文      `1.625`
/// 列表行  日志行的两行        `1.55`
/// ```
///
/// **两个值不同不是不一致，是两个角色。** 而**算法只有一套**，两套迟早会在
/// 「自然行高怎么取」这一步上分开。
///
/// **一、`lineSpacing` 不是行高倍数，是行间距。** 要表达「行高 = 字号 × k」
/// **仍须先拿到那一行的实际高度再相减**。
///
/// **二、那个实际高度算不出来，只能量**：平台字体度量（`monospacedSystemFont` 与 `systemFont`
/// 逐字号完全相同）描述的不是 SwiftUI 解析出的那个字体，任何算式都对不上
/// ⇒ **只能在视图里挂一个隐形探针去量**，见 [LineHeightProbe]。
enum TextLineHeight {
    /// 目标行高。
    static func height(fontSize: CGFloat, multiple: CGFloat) -> CGFloat {
        fontSize * multiple
    }

    /// 为达到那个行高要补的**行间距** = 目标行高 − **量出的单行高度**。
    ///
    /// `measuredLineHeight <= 0` = 探针还没报数 ⇒ 返回 `0`：
    /// **宁可这一帧偏紧，也不许补一个「目标行高」那么大的间距。**
    static func spacing(fontSize: CGFloat, measuredLineHeight: CGFloat,
                        multiple: CGFloat) -> CGFloat {
        guard measuredLineHeight > 0 else { return 0 }
        return max(0, height(fontSize: fontSize, multiple: multiple) - measuredLineHeight)
    }
}

/// 隐形探针：与被测文本**同字体**的一行，只为把 SwiftUI 实际用的行高量出来。
///
/// **它不会震荡**：**`lineSpacing` 对单行文本一个像素也不产生** ⇒ 探针的高度
/// **不依赖我们据它算出的那个间距**，测量是单向的。
///
/// **字体由调用方传**：写死的字体在两屏碰巧同字体时照常对，任一屏改了字体，
/// 探针就会安静地量另一种字的行高。给本件加参数时**不要补默认值**：
/// 默认值会让调用点继续编译，**而它们从此量的是默认那一份**。
struct LineHeightProbe: View {
    let font: Theme.TypeStyle
    let onMeasure: (CGFloat) -> Void

    var body: some View {
        Text(verbatim: "0")
            .font(font)
            .fixedSize()
            .onGeometryChange(for: CGFloat.self, of: { $0.size.height }, action: onMeasure)
            // 只用于测量，恒为 `0`，不表达任何状态，也不压在数据上。
            .opacity(0)
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
