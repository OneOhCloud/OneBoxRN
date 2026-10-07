import AVFoundation
import Core
import Observation
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "Scan")

// 扫码页真实状态。
//
// 权限四态由 AVCaptureDevice.authorizationStatus 驱动，实时取景 + metadata 识别；
// 识别出的文本经唯一解析器 ImportLink.parse 分流，失败告警确认后继续。
@MainActor
@Observable
final class ScanViewModel {
    private let onAccepted: (ImportPayload) -> Void
    /// 识别失败告警可见性（拒绝分支）；确认走 resumeAfterRejection。
    var showRejection = false

    enum Permission {
        case checking
        case askable
        case denied
        case granted
    }

    private(set) var permission: Permission = .checking
    /// 已授权而此值为 nil = 设备无相机（模拟器等环境事实）：取景框占位呈现，不崩溃。
    private(set) var camera: ScanCamera?
    @ObservationIgnored private var preparingCamera: ScanCamera?
    @ObservationIgnored private var activationGeneration: UInt64 = 0
    @ObservationIgnored private var isActive = false

    init(onAccepted: @escaping (ImportPayload) -> Void) {
        self.onAccepted = onAccepted
    }


    /// 视图出现：读系统权限落四态；notDetermined 挂载即发起系统询问。
    func activate() {
        guard !isActive else { return }
        isActive = true
        activationGeneration &+= 1
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            enterGranted()
        case .notDetermined:
            permission = .askable
            requestAccess()
        case .denied, .restricted:
            permission = .denied
        @unknown default:
            // 未来系统新增权限值按被拒呈现：保底给出「前往设置」出路（环境事实，非编程错误）。
            permission = .denied
        }
    }

    /// 视图离开：停流并释放相机（session 随视图生命周期）。
    func deactivate() {
        guard isActive else { return }
        isActive = false
        activationGeneration &+= 1
        camera?.stop()
        camera = nil
        preparingCamera?.stop()
        preparingCamera = nil
    }

    /// 可询问态主操作（挂载时也自动调用）：系统已记住的拒绝会立即回调 false，不再弹窗。
    func requestAccess() {
        Task { [weak self] in
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            guard let self else { return }
            if granted { enterGranted() } else { permission = .denied }
        }
    }

    /// 识别失败告警确认：复位闩锁重新武装继续扫。
    func resumeAfterRejection() {
        camera?.rearm()
    }

    private func enterGranted() {
        permission = .granted
        guard isActive else { return }
        if let camera {
            camera.start()
            return
        }
        guard preparingCamera == nil else { return }

        let generation = activationGeneration
        let candidate = ScanCamera { [weak self] code in self?.recognize(code) }
        preparingCamera = candidate
        candidate.prepare { [weak self, weak candidate] available in
            guard let self, let candidate else { return }
            guard self.preparingCamera === candidate else {
                candidate.stop()
                return
            }
            self.preparingCamera = nil
            guard self.isActive, self.activationGeneration == generation, available else {
                candidate.stop()
                return
            }
            self.camera = candidate
            candidate.start()
        }
    }

    // 分流（闩锁帧到达时相机已停流）：接受携 payload 进导入；拒绝按本端的口径落位。
    private func recognize(_ code: String) {
        switch ImportLink.parse(code) {
        case .accepted(let payload):
            onAccepted(payload)
        case .rejected:
            showRejection = true
        }
    }
}

// 相机采集（单路径，metadata 只认 QR）：发现、配置、delegate 与起停全部由 sessionQueue 串行化；
// 只把配置结果和首个识别值发布给 MainActor（一次识别只处理一帧）。
// @unchecked Sendable：AVCaptureSession 不声明 Sendable，但除预览层绑定外都由 sessionQueue 独占。
final class ScanCamera: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(
        label: "cloud.oneoh.networktools.scan.session",
        qos: .userInitiated
    )
    private let onCode: @MainActor @Sendable (String) -> Void
    private var configured = false
    private var latched = false

    @MainActor
    init(onCode: @escaping @MainActor @Sendable (String) -> Void) {
        self.onCode = onCode
        super.init()
    }

    /// 设备发现和 session 配置可能阻塞，仅在专用串行队列执行；结果固定回到 MainActor。
    func prepare(completion: @escaping @MainActor @Sendable (Bool) -> Void) {
        sessionQueue.async {
            let available = self.configureSession()
            Task { @MainActor in completion(available) }
        }
    }

    func start() {
        sessionQueue.async { self.startRunningIfPossible() }
    }

    func stop() {
        sessionQueue.async { self.stopRunningIfNeeded() }
    }

    /// 复位闩锁并恢复取流（识别失败告警确认后）。
    func rearm() {
        sessionQueue.async {
            self.latched = false
            self.startRunningIfPossible()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else {
            return
        }
        guard !latched else { return }
        latched = true
        stopRunningIfNeeded()
        Task { @MainActor in onCode(code) }
    }

    private func configureSession() -> Bool {
        guard let device = AVCaptureDevice.default(for: .video) else { return false }
        let input: AVCaptureDeviceInput
        do {
            input = try AVCaptureDeviceInput(device: device)
        } catch {
            // 机制故障（摄像头被别的进程占用、配置被策略禁掉）
            // 与「这台设备没有摄像头」在返回值上塌成同一个 false，界面只会显示不可用。真因不吞。
            logger.error("capture device input failed: \(describe(error), privacy: .public)")
            return false
        }

        let output = AVCaptureMetadataOutput()
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        guard session.canAddInput(input), session.canAddOutput(output) else { return false }
        session.addInput(input)
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: sessionQueue)
        guard output.availableMetadataObjectTypes.contains(.qr) else {
            session.removeOutput(output)
            session.removeInput(input)
            return false
        }
        output.metadataObjectTypes = [.qr]
        configured = true
        return true
    }

    private func startRunningIfPossible() {
        guard configured, !latched, !session.isRunning else { return }
        session.startRunning()
    }

    private func stopRunningIfNeeded() {
        guard session.isRunning else { return }
        session.stopRunning()
    }
}
