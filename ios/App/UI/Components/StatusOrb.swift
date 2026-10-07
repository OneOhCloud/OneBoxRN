import SwiftUI

// 状态圆盘（导入/扫码/配置查看共用）：语义容器色 + 语义前景图标。
struct StatusOrb: View {
    /// 独占一页的状态（扫码、配置读不出）用 `regular`；导入结果卡的页头用 `compact`，下面还要放配置卡与按钮。
    enum Size {
        case regular
        case compact

        var diameter: CGFloat {
            switch self {
            case .regular: 88
            case .compact: 64
            }
        }

        /// 字形约占直径的四成：`compact` 与 Android 同值（`28dp`）。
        var glyph: CGFloat {
            switch self {
            case .regular: 34
            case .compact: 28
            }
        }
    }

    let systemImage: String
    let tint: Color
    let container: Color
    var size: Size = .regular

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size.glyph, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size.diameter, height: size.diameter)
            .background(container, in: Circle())
    }
}
