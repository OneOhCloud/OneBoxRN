import SwiftUI

/// 弹层与页面的按钮行：贴合内容的按钮靠尾部排成一行，左弱右主，与系统对话框同一惯例。
/// 主操作落在视线与拇指的终点；单颗按钮的居中由调用方的容器决定，不经本行。
///
/// `leading` 放辅助操作（重置、删除、换一种输入方式）：贴前缘，与尾部那一组隔开留白——
/// 它与「取消 / 确定」不是同级选择。一行放不下时辅助操作换到上一行前缘，尾部那一组不拆。
struct ButtonRow<Leading: View, Trailing: View>: View {
    private let leading: Leading
    private let trailing: Trailing

    init(@ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Spacing.small) {
                leading
                Spacer(minLength: Theme.Spacing.large)
                trailing
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                leading
                HStack(spacing: Theme.Spacing.small) {
                    Spacer(minLength: 0)
                    trailing
                }
            }
        }
    }
}

extension ButtonRow where Leading == EmptyView {
    init(@ViewBuilder trailing: () -> Trailing) {
        self.init(leading: { EmptyView() }, trailing: trailing)
    }
}
