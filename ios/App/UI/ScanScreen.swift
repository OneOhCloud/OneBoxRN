import AVFoundation
import SwiftUI
import Core

// 扫码页：真实相机，权限四态由系统状态驱动，取景框内实时预览；识别之后经 ImportLink.parse 分流。
struct ScanScreen: View {
    @State private var vm: ScanViewModel
    @Environment(\.openURL) private var openURL

    init(onRecognized: @escaping (ImportPayload) -> Void) {
        _vm = State(initialValue: ScanViewModel(onAccepted: onRecognized))
    }

    var body: some View {
        @Bindable var vm = vm
        // 元素间距 `16`：识别中多出状态行与取消键，间距再大内容就顶到 dock。
        VStack(spacing: Theme.Spacing.large) {
            Spacer()
            statusView
            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.large)
        .screenBackground()
        .navigationTitle(tr("scan_title"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("scan.screen")
        .onAppear { vm.activate() }
        .onDisappear { vm.deactivate() }
        .alert(tr("scan_failed"), isPresented: $vm.showRejection) {
            Button(tr("ok"), role: .cancel) { vm.resumeAfterRejection() }
        } message: {
            Text(tr("scan_failed_caption"))
        }
    }

    @ViewBuilder
    private var statusView: some View {
        switch vm.permission {
        case .checking:
            ProgressView()
                .controlSize(.large)
            Text(tr("scan_checking"))
                .font(Theme.TypeScale.emptyTitle)
                .foregroundStyle(Theme.textPrimary)
        case .askable:
            StatusOrb(systemImage: "camera", tint: Theme.accent, container: Theme.accentContainer)
            Text(tr("scan_askable"))
                .font(Theme.TypeScale.emptyTitle)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
            ActionCapsule(title: tr("scan_request")) { vm.requestAccess() }
        case .denied:
            StatusOrb(systemImage: "camera", tint: Theme.error.fg, container: Theme.error.container)
            Text(tr("scan_denied"))
                .font(Theme.TypeScale.emptyTitle)
                .foregroundStyle(Theme.textPrimary)
            ActionCapsule(title: tr("scan_open_settings")) {
                // 跳本 App 的系统设置页；系统在相机权限变更时会终止进程，返回即以新权限重启。
                openURL(URL(string: UIApplication.openSettingsURLString)!)
            }
        case .granted:
            viewfinder
            ScanHintText(text: tr("scan_hint"))
        }
    }

    // 取景框（240×240，Radius.panel）：有相机 = 实时预览；无相机（模拟器等环境事实）= 占位形态。
    @ViewBuilder
    private var viewfinder: some View {
        if let camera = vm.camera {
            CameraPreview(session: camera.session)
                .frame(width: 240, height: 240)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel))
        } else {
            RoundedRectangle(cornerRadius: Theme.Radius.panel)
                .fill(Theme.fill)
                .frame(width: 240, height: 240)
                .overlay {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 72, weight: .light))
                        .foregroundStyle(Theme.textSecondary)
                }
        }
    }
}

/// 说明文字：`13` `textSecondary`、**居中**、**最宽 `240`**。
///
/// 拖放提示 / 相位状态 / 取景提示三处共用：分开写，单行时看起来一样，换行时才分叉。
private struct ScanHintText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.TypeScale.status)
            .foregroundStyle(Theme.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 240)
    }
}

// 主操作胶囊按钮（本页每态最多一个主操作）。
private struct ActionCapsule: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .buttonStyle(PrimaryButtonStyle())
    }
}

// 相机预览（UIViewRepresentable 单路径）：宿主 layer 即 AVCaptureVideoPreviewLayer，随布局取帧。
private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}
}
