import SwiftUI
import Core

/// 导入页的两个去处，由推入它的那一栈给。
struct ImportExits {
    /// 「完成」与自动应用收尾：回到这一栈的根。
    let finish: () -> Void
    /// 「连接」「立即使用」之后：回到首页 tab 的根，结局在电源砖上看。
    let goHome: () -> Void
}

// 导入流程页：进入后先满足平台授权前置，再启动流水线。整页是一列 `ImportPageContent`，
// 本层只管外壳：滚动、标题、流水线的生命周期、触感与自动离页。Applied（深链自动应用）自动离页。
struct ImportScreen: View {
    @State private var vm: ImportViewModel
    private let productWebsite: URL
    private let exits: ImportExits
    @Environment(\.dismiss) private var dismiss

    init(payload: ImportPayload, actions: AppActions, exits: ImportExits) {
        _vm = State(initialValue: ImportViewModel(payload: payload, actions: actions))
        productWebsite = actions.aboutLinks.website
        self.exits = exits
    }

    var body: some View {
        ScrollView {
            ImportPageContent(vm: vm, productWebsite: productWebsite, exits: exits, back: { dismiss() })
                .pageInsets(top: Theme.Spacing.extraLarge)
                .padding(.bottom, Theme.Spacing.extraLarge)
        }
        .screenBackground()
        .navigationTitle(tr("import_title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.start() } // 离开页面即取消流水线
        .onChange(of: vm.phase) { _, phase in
            if phase == .applied { exits.finish() } // Applied 自动离页
        }
        // 导入结局触感：成功结局 success、失败结局 error；过渡相位不发。
        .sensoryFeedback(trigger: vm.phase) { _, phase in
            switch phase {
            case .success, .applied: return .success
            case .failed: return .error
            case .idle, .verifying, .stopping, .downloading, .applying: return nil
            }
        }
    }
}

/// 进行中、成功、失败共用的一副骨架：页头圆盘 + 结论 + 后果，下面是这一相位的主体
/// （步骤 / 定稿配置卡 / 原始诊断），再下面是按钮。整组贴顶：按比例分余量会在大屏上顶出一大片空白。
struct ImportPageContent: View {
    let vm: ImportViewModel
    let productWebsite: URL
    let exits: ImportExits
    let back: () -> Void

    var body: some View {
        VStack(spacing: Theme.Spacing.extraLarge) {
            ImportHeader(phase: vm.phase, conclusion: vm.conclusion, hostname: UrlInfo.hostname(vm.payload.url))
            phaseBody
            actionButtons
        }
        .contentSwapTransition(vm.phase)
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch vm.phase {
        case .idle, .verifying, .stopping, .downloading, .applying:
            ProgressList(steps: importSteps(phase: vm.phase, requestedApply: vm.payload.requestedApply, willApply: vm.willApply))
                .frame(maxWidth: .infinity)
                .padding(Theme.Spacing.large)
                .cardSurface(cornerRadius: Theme.Radius.panel)
        case .success(let imported):
            ProfileSummaryCard(
                profile: imported.profile,
                productWebsite: productWebsite,
                cornerRadius: Theme.Radius.panel,
                cardBody: .inert
            )
        case .failed(let error):
            DiagnosticBox(detail: error.detailText)
                .padding(Theme.Spacing.large)
                .cardSurface(cornerRadius: Theme.Radius.panel)
        case .applied:
            EmptyView()
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        switch vm.conclusion {
        case .succeeded(let outcome, let consequence, let primary):
            let labels = ImportConclusionText.success(outcome: outcome, consequence: consequence, primary: primary)
            ButtonRow {
                Button(labels.secondary, action: exits.finish)
                    .buttonStyle(SecondaryButtonStyle())
                Button(labels.primary) {
                    Task { await vm.perform(primary) }
                    exits.goHome()
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        case .failed(let actions):
            let labels = ImportConclusionText.failure(actions)
            ButtonRow {
                if let secondary = labels.secondary {
                    Button(secondary, action: back)
                        .buttonStyle(SecondaryButtonStyle())
                }
                switch actions {
                case .retryOrBack:
                    Button(labels.primary) { Task { await vm.retry() } }
                        .buttonStyle(PrimaryButtonStyle())
                case .backOnly:
                    Button(labels.primary, action: back)
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
        case nil:
            EmptyView()
        }
    }
}

/// 页头：圆盘 + 结论 + 后果。三类相位同一副，页面换相位时只换字与色，位置不动。
private struct ImportHeader: View {
    let phase: ImportViewModel.Phase
    let conclusion: ImportConclusion?
    let hostname: String

    var body: some View {
        VStack(spacing: 0) {
            StatusOrb(systemImage: icon, tint: tone.fg, container: tone.container, size: .compact)
            Text(title)
                .font(Theme.TypeScale.pageTitle)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, Theme.Spacing.medium)
            if let note {
                Text(note)
                    .font(noteType)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, Theme.Spacing.extraSmall)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var icon: String {
        switch phase {
        case .success, .applied: return "checkmark"
        case .failed: return "exclamationmark.triangle"
        case .idle, .verifying, .stopping, .downloading, .applying: return "link"
        }
    }

    private var tone: Theme.Tone {
        switch phase {
        case .success, .applied: return Theme.success
        case .failed: return Theme.error
        case .idle, .verifying, .stopping, .downloading, .applying: return Theme.Tone(fg: Theme.accent, container: Theme.accentContainer)
        }
    }

    private var title: String {
        switch phase {
        case .success(let imported):
            return successLabels(imported)?.headline ?? tr("import_success")
        case .applied: return tr("import_success")
        case .failed(let error): return error.titleText
        case .idle, .verifying, .stopping, .downloading, .applying: return tr("import_hint")
        }
    }

    /// 进行中只写主机名：整串链接带着令牌，又长又没人读。自动应用成功即离页，页头只在退场时一闪，不加后果句。
    private var note: String? {
        switch phase {
        case .success(let imported): return successLabels(imported)?.consequence
        case .applied: return nil
        case .failed(let error): return error.hintText
        case .idle, .verifying, .stopping, .downloading, .applying: return hostname.isEmpty ? nil : hostname
        }
    }

    private var noteType: Theme.TypeStyle {
        switch phase {
        case .idle, .verifying, .stopping, .downloading, .applying: return Theme.TypeScale.control.monospaced()
        case .success, .applied, .failed: return Theme.TypeScale.control
        }
    }

    private func successLabels(_ imported: ImportedProfile) -> ImportSuccessLabels? {
        guard case .succeeded(_, let consequence, let primary) = conclusion else { return nil }
        return ImportConclusionText.success(outcome: imported.outcome, consequence: consequence, primary: primary)
    }
}

private struct ProgressList: View {
    let steps: [ImportProgressStep]

    var body: some View {
        VStack(spacing: Theme.Spacing.medium) {
            ForEach(steps) { step in
                ProgressRow(step: step)
            }
        }
    }
}

private struct ProgressRow: View {
    let step: ImportProgressStep

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            StepMarker(status: step.status)
            Text(tr(step.labelKey))
                // 阶段标签 `13`；用字重区分 running（同档的 500 / 400 两支）。
                .font(step.status == .running ? Theme.TypeScale.statusEmphasis : Theme.TypeScale.status)
                .foregroundStyle(step.status == .pending ? Theme.textSecondary : Theme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct StepMarker: View {
    let status: ImportProgressStatus

    var body: some View {
        switch status {
        case .pending:
            Circle()
                // 待办点的淡色由它构造；「待办 / 进行中 / 完成」本身由 switch 换控件表达，不靠浓淡分辨。
                .fill(Theme.textSecondary.opacity(0.35))
                .frame(width: 10, height: 10)
                .frame(width: 20, height: 20)
        case .running:
            ProgressView()
                .controlSize(.small)
                .frame(width: 20, height: 20)
        case .done:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.success.fg)
                .frame(width: 20, height: 20)
        case .failed:
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.error.fg)
                .frame(width: 20, height: 20)
        }
    }
}

private enum ImportProgressStatus {
    case pending
    case running
    case done
    case failed
}

private struct ImportProgressStep: Identifiable {
    let labelKey: String
    let status: ImportProgressStatus
    var id: String { labelKey }
}

private func importSteps(
    phase: ImportViewModel.Phase,
    requestedApply: Bool,
    willApply: Bool
) -> [ImportProgressStep] {
    let includesVerification = requestedApply || phase == .verifying
    let includesStop = willApply || phase == .stopping || phase == .applying || phase == .applied || phase.isStartFailure
    let labels = [
        includesVerification ? "import_step_verify" : nil,
        includesStop ? "import_step_stop" : nil,
        "import_step_download",
        includesStop ? "import_step_apply" : nil
    ].compactMap { $0 }
    let current = currentStepKey(phase)
    let terminal = phase.isSuccess
    let failed = phase.isFailure
    return labels.map { label in
        ImportProgressStep(
            labelKey: label,
            status: progressStatus(label: label, current: current, labels: labels, terminal: terminal, failed: failed)
        )
    }
}

private func currentStepKey(_ phase: ImportViewModel.Phase) -> String? {
    switch phase {
    case .idle, .success, .applied:
        return nil
    case .verifying:
        return "import_step_verify"
    case .stopping:
        return "import_step_stop"
    case .downloading:
        return "import_step_download"
    case .applying:
        return "import_step_apply"
    case .failed(let error):
        switch error {
        case .startFailed: return "import_step_apply"
        case .downloadNetwork, .downloadHttp, .invalidContent: return "import_step_download"
        }
    }
}

private func progressStatus(
    label: String,
    current: String?,
    labels: [String],
    terminal: Bool,
    failed: Bool
) -> ImportProgressStatus {
    if terminal { return .done }
    if failed, label == current { return .failed }
    if label == current { return .running }
    guard let current, let labelIndex = labels.firstIndex(of: label), let currentIndex = labels.firstIndex(of: current) else {
        return .pending
    }
    return labelIndex < currentIndex ? .done : .pending
}

private extension ImportViewModel.Phase {
    var isSuccess: Bool {
        switch self {
        case .success, .applied: return true
        case .idle, .verifying, .stopping, .downloading, .applying, .failed: return false
        }
    }

    var isFailure: Bool {
        switch self {
        case .failed: return true
        case .idle, .verifying, .stopping, .downloading, .applying, .success, .applied: return false
        }
    }

    var isStartFailure: Bool {
        guard case .failed(.startFailed) = self else { return false }
        return true
    }
}

func importProgressTokens(
    phase: ImportViewModel.Phase,
    requestedApply: Bool,
    willApply: Bool = false
) -> [String] {
    importSteps(phase: phase, requestedApply: requestedApply, willApply: willApply).map { step in
        let label = switch step.labelKey {
        case "import_step_verify": "verify"
        case "import_step_stop": "stop"
        case "import_step_download": "download"
        case "import_step_apply": "apply"
        default: preconditionFailure("unknown import step label")
        }
        let status = switch step.status {
        case .pending: "pending"
        case .running: "running"
        case .done: "done"
        case .failed: "failed"
        }
        return "\(label):\(status)"
    }
}

// 原始诊断：分类提示已在页头，这里只放原文（可滚动）。
private struct DiagnosticBox: View {
    let detail: String

    var body: some View {
        // 原始诊断是**任意长度的文本**，属文档视图：这条竖线在这里是
        // 「下面还有」，不是占位。宿主页整体是版式页不改变这一格的归类。
        ScrollView {
            Text(detail)
                .font(Theme.TypeScale.subtitle.monospaced())
                .foregroundStyle(Theme.error.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Spacing.medium)
        }
        .frame(maxHeight: 96)
        .background(Theme.error.container, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
    }
}
