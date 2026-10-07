import Observation
import Core

@MainActor
protocol ImportActions: AnyObject {
    /// 首页电源砖读的那个状态：结论页主按钮与砖同一语义，不另判一次连没连着。
    var heroState: HomeViewModel.HeroState { get }

    func requiresTunnelAuthorization(for payload: ImportPayload) -> Bool

    func prepareTunnelAuthorization() async throws

    func importProfile(
        payload: ImportPayload,
        onPhase: (ImportPhase) -> Void
    ) async throws -> ImportPhase

    func connect()

    /// 切换配置那一条隧道处置：新导入的那份已是当前配置，「立即使用」只差这一步。
    func applyActiveProfileChange() async throws
}

// 导入流程页真实驱动：受信自动应用先完成系统隧道授权，再经
// AppActions.importProfile 驱动 core ImportFlow；相位依序映射到展示态（IDLE 为初值）。
// 重入：在途闩锁保证同页至多一条流水线；进页只跑一次，重跑只经失败页的「重试」。
// 取消（离开页面）原样上抛，不改相位。
@MainActor
@Observable
final class ImportViewModel {
    enum Phase: Equatable {
        case idle
        case verifying
        case stopping
        case downloading
        case applying
        /// 带回存好的那一份：配置列表要等流水线收尾才重发，结果卡不去读它。
        case success(ImportedProfile)
        case applied
        case failed(ImportError)
    }

    let payload: ImportPayload
    private let actions: any ImportActions
    private(set) var phase: Phase = .idle
    private(set) var willApply = false
    @ObservationIgnored private var inFlight = false

    init(payload: ImportPayload, actions: any ImportActions) {
        self.payload = payload
        self.actions = actions
    }

    /// 结论只在成功与失败时有。成功页的主按钮跟电源砖**此刻**的动作走：页开着时隧道连上或断开，按钮跟着换。
    var conclusion: ImportConclusion? {
        switch phase {
        case .success(let imported):
            return .of(outcome: imported.outcome, heroAction: deriveHeroAction(actions.heroState))
        case .failed(let error):
            return .of(error: error)
        // **逐项列全而不写 `default:`**：新加一个相位时，编译器逼人回到这里判它有没有结论。
        case .idle, .verifying, .stopping, .downloading, .applying, .applied:
            return nil
        }
    }

    /// 进页即跑。已经跑过（有了相位）再出现不重跑：成功之后切走再切回来，不会把同一份再导一遍。
    func start() async {
        if payload.url.isEmpty { return } // 深链拒绝以空载荷落导入页默认态——不启动流水线，停 IDLE
        guard phase == .idle else { return }
        await run()
    }

    /// 失败页「重试」：只有判定给了重试的失败才重跑。启动失败时配置已经存下，重跑只会重下同一份。
    func retry() async {
        guard case .failed(.retryOrBack) = conclusion else { return }
        phase = .idle
        await run()
    }

    /// 成功页主按钮。两者都不等结局：调用方随即回首页，结局在电源砖与失败卡上看；
    /// 启动失败的诊断由动作层落 lastError、经全局失败弹层呈现，这里不二次接。
    func perform(_ action: ImportConclusion.PrimaryAction) async {
        switch action {
        case .connect: actions.connect()
        case .useNow: try? await actions.applyActiveProfileChange()
        }
    }

    private func run() async {
        if inFlight { return } // 在途闩锁
        inFlight = true
        defer { inFlight = false }
        willApply = false
        if actions.requiresTunnelAuthorization(for: payload) {
            do {
                try await actions.prepareTunnelAuthorization()
            } catch is CancellationError {
                return
            } catch {
                phase = .failed(.startFailed(message: String(describing: error)))
                return
            }
        }
        do {
            _ = try await actions.importProfile(payload: payload) { corePhase in
                if corePhase.impliesAutomaticApply { willApply = true }
                phase = Phase(mirroring: corePhase)
            }
        } catch {
            // 仅调用方作用域取消可上抛（离开页面即取消，不改相位）；其余异常即流水线契约违背。
            precondition(error is CancellationError, "unexpected import pipeline error: \(error)")
        }
    }
}

private extension ImportPhase {
    var impliesAutomaticApply: Bool {
        switch self {
        case .stopping, .applying, .applied:
            return true
        case .downloading(let willApply):
            return willApply
        case .verifying, .success, .failed:
            return false
        }
    }
}

private extension ImportViewModel.Phase {
    init(mirroring phase: ImportPhase) {
        switch phase {
        case .verifying: self = .verifying
        case .stopping: self = .stopping
        case .downloading: self = .downloading
        case .applying: self = .applying
        case .success(_, let imported): self = .success(imported)
        case .applied: self = .applied
        case .failed(let error): self = .failed(error)
        }
    }
}
