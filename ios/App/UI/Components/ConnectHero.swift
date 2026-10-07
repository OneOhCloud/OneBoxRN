import SwiftUI

/// 电源砖与光晕。整个产品唯一的主操作。
///
/// 值得全仓最重的一份材质，但那份材质是**静态光学**，不是运动：**禁止光环、旋转 spinner、
/// 呼吸缩放、粒子、进度环**——它们都在暗示「系统正在努力」，而启动引擎通常一秒内结束；
/// 一个持续运动的控件会让快的操作显得慢，也会让真正的失败态失去对比度。
/// 进行感由砖下方的状态行文字与状态点承担。
struct ConnectHero: View {
    /// 连接相位：决定填充、图标色与光晕透明度三者，是本组件唯一的输入状态。
    enum Phase {
        case idle
        case connecting
        case connected
    }

    /// 砖上的那一枚符号。没有配置时同一块砖是导入入口：外形、分档、光晕规则都不变，只换符号与读屏标签。
    enum Glyph {
        case power
        case importConfig
    }

    let phase: Phase
    let geometry: HeroGeometry
    var glyph: Glyph = .power
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    var body: some View {
        ZStack(alignment: .top) {
            aura
            tile
        }
        // 光晕比砖大、且从砖顶向下偏移起画，故整块的自然尺寸由光晕决定。
        // 固定成砖的尺寸，让光晕溢出而不推动版式（任何状态切换都不得改变元素位置）。
        // **框必须顶对齐**：光晕在时整块比框大，默认居中会把它（连同顶对齐在里面的砖）
        // 整体顶高半个差值；光晕不在时又不顶——连接那一刻砖往上跳。
        .frame(width: geometry.tileSide, height: geometry.tileSide, alignment: .top)
    }

    // —— 电源砖 ——

    private var tile: some View {
        Button(action: action) {
            Image(systemName: symbolName)
                .font(.system(size: geometry.iconSize, weight: .semibold))
                .foregroundStyle(iconColor)
                .frame(width: geometry.tileSide, height: geometry.tileSide)
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.hero * geometry.scale))
        }
        .buttonStyle(HeroTileStyle(phase: phase, geometry: geometry, isHovering: isHovering))
        .onHover { isHovering = $0 }
        // 标签说的是「按下去会发生什么」，不是图标名。
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(phase == .connected ? .isSelected : [])
        // 主操作触感（medium）。
        .sensoryFeedback(.impact(weight: .medium), trigger: phase)
        .animation(reduceMotion ? nil : Theme.motion(Theme.Motion.heroSurface), value: phase)
    }

    private var symbolName: String {
        switch glyph {
        case .power: return "power"
        case .importConfig: return "plus"
        }
    }

    private var accessibilityText: String {
        switch glyph {
        case .power: return tr(phase == .connected ? "home_disconnect" : "home_connect")
        case .importConfig: return tr("home_empty_import")
        }
    }

    /// 导入入口取强调色：没有配置时它是这一页唯一的主操作，灰色的加号读起来像是不可点。
    private var iconColor: Color {
        if glyph == .importConfig { return Theme.accent }
        switch phase {
        case .idle: return Theme.textSecondary
        case .connecting: return Theme.accent
        case .connected: return Theme.onAccent
        }
    }

    // —— 光晕 ——

    /// `auraSide` 正圆，圆心比砖心低 `auraCenterDrop`、水平居中、**在砖之下**，不接收点击。
    /// 未连接时**完全不渲染**，不是透明度 0 的空图层。
    @ViewBuilder
    private var aura: some View {
        if let opacity = auraOpacity {
            Circle()
                .fill(
                    RadialGradient(
                        // 径向渐变的外端色，渐变到全透明，不表达任何状态。
                        colors: [Theme.Hero.auraCore, Theme.Hero.auraCore.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: geometry.auraEndRadius
                    )
                )
                .blur(radius: geometry.auraBlur)
                .frame(width: geometry.auraSide, height: geometry.auraSide)
                .offset(y: geometry.auraTopOffset)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                // 光晕整体随连接相位淡入淡出；未连接时它完全不渲染。
                .opacity(opacity)
                // 减少动态效果时光晕仍按相位切换透明度（那不是位移或缩放），但去掉过渡时长。
                .animation(reduceMotion ? nil : Theme.motion(Theme.Motion.heroAura), value: opacity)
        }
    }

    private var auraOpacity: Double? {
        switch phase {
        case .idle: return nil
        case .connecting: return 0.55
        case .connected: return 1
        }
    }
}

/// 电源砖里与边长无关的量。
enum HeroMetrics {
    /// 基准砖边长：`HeroGeometry` 各项的原始量都按它定。
    static let referenceTileSide: CGFloat = 160
    /// 径向渐变在这一比例处完全透明。**它的分母是「中心到最远角」**，见 `HeroGeometry.auraEndRadius`。
    static let auraFadeStop: CGFloat = 0.66
    /// 指针悬停上移量（iPad 指针）。
    static let hoverLift: CGFloat = 0.5
    /// 按下形变。
    static let pressedScale: CGFloat = 0.975
    /// 内侧高光的线宽。
    static let edgeWidth: CGFloat = 1.5
}

/// 电源砖随边长变化的尺寸账。
///
/// **各项的原始量都按基准砖 `160` 定，再按 `scale` 等比**：砖边长一变，图标、光晕、模糊半径
/// 与圆角必须同比跟上，否则光晕相对砖缩小、圆角相对砖变方。
struct HeroGeometry: Equatable {
    let tileSide: CGFloat

    var scale: CGFloat { tileSide / HeroMetrics.referenceTileSide }
    var iconSize: CGFloat { 44 * scale }
    var auraSide: CGFloat { 240 * scale }
    /// 光晕圆心比砖心低多少——要守的不变量按圆心写。
    var auraCenterDrop: CGFloat { 58 * scale }
    /// 光晕相对砖顶的下移量（`ZStack(alignment: .top)` 下的上沿偏移），由圆心不变量反解，
    /// 不单独取值：单独取值时改 `auraSide` 会让光晕静默滑离砖心。基准砖上即 `80 + 58 − 120 = 18`。
    var auraTopOffset: CGFloat { tileSide / 2 + auraCenterDrop - auraSide / 2 }
    /// 光晕渐变的结束半径（基准砖上 ≈ `112`）。
    ///
    /// **分母写在这里，不写在 `auraFadeStop` 那个数里**：`0.66` 是相对**中心到最远角**的比例
    /// —— CSS `radial-gradient(circle, …)` 的 `<size>` 默认 `farthest-corner`，参考实现即此。
    var auraEndRadius: CGFloat { auraSide / 2 * 2.0.squareRoot() * HeroMetrics.auraFadeStop }
    var auraBlur: CGFloat { 44 * scale }
}

/// 电源砖的三层光学。必须是 ButtonStyle，理由同 PrimaryButtonStyle。
private struct HeroTileStyle: ButtonStyle {
    let phase: ConnectHero.Phase
    let geometry: HeroGeometry
    let isHovering: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(tileBackground)
            // **两道描边，不是一道**：顶/底那道是垂直渐变，左边那道是水平渐变。
            // 叠在一起才是「顶边与左边各一道亮线（顶边更亮），底边一道极淡暗线」。
            .overlay {
                shape.strokeBorder(edgeGradient, lineWidth: HeroMetrics.edgeWidth)
                shape.strokeBorder(leadingEdgeGradient, lineWidth: HeroMetrics.edgeWidth)
            }
            .shadow(color: glowColor, radius: Theme.Hero.idleGlow.radius * geometry.scale)
            .scaleEffect(configuration.isPressed ? HeroMetrics.pressedScale : 1)
            .offset(y: isHovering && !configuration.isPressed ? -HeroMetrics.hoverLift : 0)
            .animation(
                reduceMotion ? nil : Theme.motion(configuration.isPressed ? Theme.Motion.heroPressDown : Theme.Motion.heroPress),
                value: configuration.isPressed
            )
    }

    /// 砖面：`fillGradient`，无条件。
    private var tileBackground: some View {
        shape.fill(fillGradient)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Theme.Radius.hero * geometry.scale)
    }

    /// `140°` 线性渐变，三个停靠点（`0% / 52% / 100%`）。
    /// SwiftUI 的起止点用单位坐标表达同一方向：`140°` 顺时针自上方起量 ⇒ 左上偏上 → 右下偏下。
    private var fillGradient: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: isActive ? Theme.Hero.activeStart : Theme.Hero.idleStart, location: 0),
                .init(color: isActive ? Theme.Hero.activeMiddle : Theme.Hero.idleMiddle, location: 0.52),
                .init(color: isActive ? Theme.Hero.activeEnd : Theme.Hero.idleEnd, location: 1),
            ],
            startPoint: UnitPoint(x: 0.17, y: 0),
            endPoint: UnitPoint(x: 0.83, y: 1)
        )
    }

    /// **顶边与底边**那一道：顶最亮、底一道极淡暗线，中段透明 ⇒ 读起来是光而不是描边。
    ///
    /// **它只负责竖直那一维**：一条 `.top → .bottom` 的渐变没有任何左向分量，
    /// 左边那道由 `leadingEdgeGradient` 单画。
    private var edgeGradient: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: isActive ? Theme.Hero.activeEdgeHighlight : Theme.Hero.idleEdgeHighlight, location: 0),
                .init(color: .clear, location: 0.45),
                .init(color: isActive ? Theme.Hero.activeEdgeShade : Theme.Hero.idleEdgeShade, location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// **左边**那一道（「顶边与左边各一道亮线」的第二道）。
    ///
    /// 与上面那道同构：起点最亮、`0.45` 处透明、**末端不放暗线**
    /// —— 暗线只有底边一道，右边不画。
    private var leadingEdgeGradient: LinearGradient {
        LinearGradient(
            stops: [
                .init(
                    color: isActive
                        ? Theme.Hero.activeEdgeHighlightLeading
                        : Theme.Hero.idleEdgeHighlightLeading,
                    location: 0
                ),
                .init(color: .clear, location: 0.45),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    /// 已连接时这一圈让给砖下那团蓝色光晕，自己不画；取透明而不是摘掉修饰符，
    /// 切换时它随 `heroSurface` 淡出，不是一跳。
    private var glowColor: Color {
        isActive ? .clear : Theme.Hero.idleGlow.color
    }

    private var isActive: Bool { phase == .connected }
}
