import SwiftUI

/// 一行此刻处于什么交互态，以及它该用哪一档填充（分组卡内的行靠填充分开，不靠线）。
///
/// 各行样式的 `ButtonStyle.makeBody` 都按 `isPressed` 与 `isHovering` 算同一个填充，统一走这里。
///
/// **不传两个并列的布尔**：`hovering` 与 `pressed` 描述的是同一件事——这一行的交互态，
/// 而它们的合法组合只有三种（闲置 / 悬停 / 按下），不是 2×2。按下优先于悬停：
/// 手指或指针按下去的时候，那一下比「停在上面」更强。
enum RowInteraction {
    case idle
    case hovering
    case pressed

    init(hovering: Bool, pressed: Bool) {
        if pressed { self = .pressed }
        else if hovering { self = .hovering }
        else { self = .idle }
    }

    /// 压在 `surface` 上的行填充。闲置态透明——让它落回承载容器自己的底色。
    var fill: Color {
        switch self {
        case .idle: return .clear
        case .hovering: return Theme.rowHover
        case .pressed: return Theme.rowActive
        }
    }
}
