import SwiftUI

// 空态：各页空态都走这一个组件，两端同（首页无配置时是导入砖，不算空态）。
// 形状 = 说明原因 + 给出下一步。入场无动画。
struct EmptyState: View {
    let systemImage: String
    let title: String
    var caption: String?
    var actionLabel: String?
    var action: (() -> Void)?
    var actionIdentifier: String?

    var body: some View {
        VStack(spacing: Theme.Spacing.large) {
            Spacer(minLength: 0)
            Image(systemName: systemImage)
                .font(.system(size: EmptyStateMetrics.iconSize, weight: .medium))
                .foregroundStyle(Theme.accent)
                .frame(width: EmptyStateMetrics.tileSide, height: EmptyStateMetrics.tileSide)
                .background(Theme.accentContainer, in: RoundedRectangle(cornerRadius: Theme.Radius.panel))
            Text(title)
                .font(Theme.TypeScale.emptyTitle)
                .foregroundStyle(Theme.textPrimary)
            if let caption {
                Text(caption)
                    .font(Theme.TypeScale.status)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: EmptyStateMetrics.captionWidth)
            }
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier(actionIdentifier ?? "")
            }
            Spacer(minLength: 0)
        }
        // 在剩余视口里垂直居中，**不套固定最小高的盒子**。
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // **这里不加水平内衬**（水平边距 = 该页的页边距）：页边距是**页级**关切，
        // 同页其它元素都已由页容器供给，空态不该持有第二份。
    }
}

enum EmptyStateMetrics {
    static let tileSide: CGFloat = 64
    /// 砖内**图标字形**。
    /// **不是从 `tileSide`(64) 推出来的** —— 参考那一族的容器:图标比值全距 `0.275`–`0.786`，
    /// 不是常数；`30` 与参考一致。
    static let iconSize: CGFloat = 30
    static let captionWidth: CGFloat = 240
}
