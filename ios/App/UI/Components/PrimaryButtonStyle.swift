import SwiftUI

// 实心主按钮：每个可见任务区域最多一个。
// 用法：Button(...) { Text(...) }.buttonStyle(PrimaryButtonStyle())，排布交给 `ButtonRow`。
//
// 主 / 次 / 弱三种按钮同为胶囊、宽度贴合内容；宽度与形状只在样式里定，调用点不再加 `frame` / `fixedSize`。
//
// 必须是 ButtonStyle 而不是在 Button 外面挂 foregroundStyle + background：后者依赖默认按钮样式
// 恰好无边框、继承前景色；ButtonStyle 直接取代默认样式，外观不随系统默认样式漂。
struct PrimaryButtonStyle: ButtonStyle {
    /// 主操作恒为实心强调色：「能不能提交」由点击后的就地校验回答，不靠把按钮置灰。
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(GlyphLabelStyle(text: Theme.TypeScale.control))
            .font(Theme.TypeScale.control.weight(.semibold))
            .padding(.horizontal, ButtonMetrics.hugHorizontalInset)
            .frame(minHeight: ButtonMetrics.height)
            .fixedSize()
            .foregroundStyle(Theme.onAccent)
            .background(Theme.accent, in: Capsule())
            .opacity(configuration.isPressed ? ButtonMetrics.pressedOpacity : 1)
    }
}

enum ButtonMetrics {
    /// 主 / 次 / 弱三种按钮共用的高度。
    static let height: CGFloat = 40
    /// 按压反馈统一为透明度，不做缩放。
    static let pressedOpacity: Double = 0.85
    /// 禁用态：容器与内容同降。主按钮不走它——深色容器压浅色标签时「同降」会塌到读不出。
    ///
    /// `InputField` 的禁用 `0.55` 不并进来：那一档要让**标签仍可辨认**，与「按不动」是两个角色。
    static let disabledOpacity: Double = 0.5
    /// 胶囊型次操作（回顶胶囊、跟随胶囊、状态药丸按钮）更矮一档。
    static let capsuleHeight: CGFloat = 32
    /// 文字与胶囊端头之间的呼吸量：没有它胶囊紧贴文字，首尾两字被端头啃掉。
    static let hugHorizontalInset: CGFloat = 20
}
