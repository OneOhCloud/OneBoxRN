import SwiftUI
import Core

// 导入 URL sheet（首页导入砖 / 导入卡与 Profiles 导入行共用）。
// 手输判定唯一经 core ImportLink.parse：拒绝 → 输入组件内联错误，不跳转；
// 接受 → 关闭 sheet 并携 payload 进入导入流程。不发真实请求。
struct ImportSheet: View {
    let onSubmit: (ImportPayload) -> Void
    let onScan: () -> Void
    let onCancel: () -> Void

    @State private var url = ""
    @State private var validationError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            Text(tr("import_title"))
                .font(Theme.TypeScale.pageTitle)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            // 纯文本行在面板内衬之外再内缩一档，与输入框里的文字落在同一条读字边线上。
            .padding(.horizontal, SheetInset.textExtra)
            .padding(.top, Theme.Spacing.extraLarge)
            InputField(form: .editor(label: tr("import_url_label"), ground: .surface), text: $url, placeholder: "https://", error: validationError)
                .keyboardType(.URL)
                .plainTextInput()
            // 扫码是拿到同一个 URL 的另一条路，与取消、导入同排一行：左弱、中次、右主。
            ButtonRow {
                Button(tr("cancel"), action: onCancel)
                    .buttonStyle(QuietButtonStyle())
                Button(action: onScan) {
                    Label(tr("import_scan"), systemImage: "qrcode.viewfinder")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("import.scan")
                Button(tr("import_action"), action: submit)
                    .buttonStyle(PrimaryButtonStyle())
            }
            .padding(.top, Theme.Spacing.small)
        }
        // 带底色的圆角块（InputField、按钮）到弹层边的距离，取值与理由见 `SheetInset.panel`。
        .padding(.horizontal, SheetInset.panel)
        // 按内容求高：结构末尾**不放 Spacer**，内容不为填满弹层而拉伸。
        .fittedSheetChrome()
        // 暗色下 `background` 是纯黑，而被 53% 黑遮罩压暗的页面也是纯黑（对比 1.000）——
        // **任何压在黑上的黑色手段贡献都为零**：投影是 `rgba(0,0,0,0.65)`、遮罩是黑，都看不见。
        // 故面板取 `surface`：本弹层内没有 `surface` 卡片，那一面只能由面板自己承担，
        // 否则暗色下读起来是一堆浮空的文字（暗色靠填充差分层）。
        .presentationBackground(Theme.surface)
    }

    private func submit() {
        switch ImportLink.parse(url) {
        case .accepted(let payload):
            validationError = nil
            onSubmit(payload)
        case .rejected:
            // 手输实际可达拒因为 NOT_LINK；就地错误提示，弹层不关闭。
            validationError = tr("import_url_invalid")
        }
    }
}
