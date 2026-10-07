import SwiftUI
import Core

// 规则编辑 sheet（Rules 页呈现）：动作/匹配类型分段 + 多行批量输入 + 实时校验与预览。
// 拆分/normalize/校验全部委派 core RuleToken（校验唯一实现于 core）；
// 新增可批量（每行/逗号分隔一条），编辑取首个有效值。
struct RuleComposer: View {
    let editing: Rule?
    let onSave: (_ action: RuleAction, _ kind: RuleKind, _ values: [String]) -> Void
    let onDelete: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    @State private var action: RuleAction
    @State private var kind: RuleKind
    @State private var valueText: String
    @State private var validation: RuleComposerValidation
    @State private var isSaving = false
    /// 点保存时一条有效值都没有：就地落在输入框上，改输入即撤。
    @State private var valuesError: String?

    init(
        editing: Rule?,
        onSave: @escaping (_ action: RuleAction, _ kind: RuleKind, _ values: [String]) -> Void,
        onDelete: (() -> Void)? = nil
    ) {
        self.editing = editing
        self.onSave = onSave
        self.onDelete = onDelete
        let initialKind = editing?.kind ?? .domainSuffix
        let initialValue = editing?.value ?? ""
        _action = State(initialValue: editing?.action ?? .proxy)
        _kind = State(initialValue: initialKind)
        _valueText = State(initialValue: initialValue)
        _validation = State(initialValue: RuleComposerValidation.evaluate(text: initialValue, kind: initialKind))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.large) {
                // **这里不居中**：任务型页面的标题按阅读方向起始边对齐，
                // 仅连接状态等单一英雄信息可以居中；`ImportSheet` / `HelpSheet` 的居中是各自的例外。
                ContentModalHeading(text: tr(editing == nil ? "rules_composer_add" : "rules_composer_edit"))
                    .padding(.horizontal, SheetInset.textExtra)
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Text(tr("rules_composer_action"))
                        .font(Theme.TypeScale.subtitle)
                        .foregroundStyle(Theme.textSecondary)
                    SegmentPicker(
                        title: tr("rules_composer_action"),
                        options: RuleAction.allCases.map { ($0, RuleBadge.label($0)) },
                        selection: $action
                    )
                }
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Text(tr("rules_composer_kind"))
                        .font(Theme.TypeScale.subtitle)
                        .foregroundStyle(Theme.textSecondary)
                    SegmentPicker(
                        title: tr("rules_composer_kind"),
                        options: selectableKinds.map { ($0, RuleChip.label($0)) },
                        selection: $kind
                    )
                }
                InputField(
                    form: .editor(label: tr("rules_composer_values"), ground: .surface),
                    text: $valueText,
                    placeholder: kind == .ipCidr ? "10.0.0.0/8" : "example.com",
                    error: valuesError,
                    multiline: true
                )
                .plainTextInput()
                .onChange(of: valueText) { valuesError = nil }
                .keyboardType(kind == .ipCidr ? .numbersAndPunctuation : .URL)
                validationSummary
                if let first = validation.validTokens.first {
                    previewRow(first: first)
                }
                Text(tr("rules_composer_priority"))
                    .font(Theme.TypeScale.meta)
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, SheetInset.panel)
            .padding(.top, Theme.Spacing.large)
        }
        .safeAreaInset(edge: .bottom) { actionBar }
        .presentationDetents([.large])
        // 暗色下 `background` 是纯黑，而被 53% 黑遮罩压暗的页面也是纯黑（对比 1.000）——
        // **任何压在黑上的黑色手段贡献都为零**：投影是 `rgba(0,0,0,0.65)`、遮罩是黑，都看不见。
        // 故面板取 `surface`：本弹层内没有 `surface` 卡片，那一面只能由面板自己承担，
        // 否则暗色下读起来是一堆浮空的文字（暗色靠填充差分层）。
        .presentationBackground(Theme.surface)
        .interactiveDismissDisabled(isSaving)
        .contentSwapTransition(validation.validTokens.count)
        .task(id: RuleValidationInput(text: valueText, kind: kind)) {
            await refreshValidation(for: RuleValidationInput(text: valueText, kind: kind))
        }
    }

    // 操作区固定于 sheet 底部：表单滚动，动作不悬浮在页中。
    //
    // **删除贴前缘、取危险色**，与尾部「取消 / 保存」隔开：紧挨的两颗读起来是一对，
    // 把「放弃」与「删除这条规则」摆成一对，等于让破坏性动作冒充「取消」的同级选项。
    private var actionBar: some View {
        ButtonRow {
            if editing != nil, let onDelete {
                Button(tr("delete")) { dismiss(); onDelete() }
                    .buttonStyle(SecondaryButtonStyle(tone: Theme.error))
                    .disabled(isSaving)
            }
        } trailing: {
            cancelButton
            saveButton
        }
        .actionBarChrome()
    }

    private var saveButton: some View {
        Button(tr("rules_save"), action: save)
            .buttonStyle(PrimaryButtonStyle())
            // 只在保存进行中按不动（防重入）；有没有有效值由点下后的校验回答。
            .disabled(isSaving)
    }

    private var cancelButton: some View {
        Button(tr("cancel")) { dismiss() }
            .buttonStyle(QuietButtonStyle())
            .disabled(isSaving)
    }

    private var validationSummary: some View {
        HStack(spacing: Theme.Spacing.medium) {
            Text(tr("rules_composer_valid", String(validation.validTokens.count)))
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(validation.validTokens.isEmpty ? Theme.textSecondary : Theme.success.fg)
            if validation.skippedCount > 0 {
                Label(
                    tr("rules_composer_skipped", String(validation.skippedCount)),
                    systemImage: "exclamationmark.circle"
                )
                    .font(Theme.TypeScale.subtitle)
                    .foregroundStyle(Theme.warning.fg)
            }
        }
    }

    private func previewRow(first: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text(tr("rules_composer_preview"))
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: Theme.Spacing.small) {
                RuleBadge(action: action)
                RuleChip(kind: kind)
                Text(first)
                    // 预览块里的值 `12` 等宽：本行其余每一处文本都是 `12`。
                    .font(Theme.TypeScale.subtitle.monospaced())
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if validation.validTokens.count > 1 {
                    Text(verbatim: "+\(validation.validTokens.count - 1)")
                        .font(Theme.TypeScale.subtitle.monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(Theme.Spacing.medium)
            .frame(maxWidth: .infinity, alignment: .leading)
            // **`fill` 不是 `surface`**：本弹层面板取 `surface`，预览块再取 `surface` 就与承载它的面同色、
            // 分离度为 `0`（与统一输入组件同一个成因）。
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
        }
    }

    /// 编辑态禁止跨类改匹配类型（域名类 ↔ IP 段类互斥），与批量值语义绑定。
    ///
    /// 跨类项**不出现**而不是灰显：系统分段控件不支持单段禁用，且「点不了的东西就别摆出来」——
    /// 灰项占着位置，还逼用户逐个试才知道哪个能点。
    private var selectableKinds: [RuleKind] {
        guard let editing else { return RuleKind.allCases }
        switch editing.kind {
        case .domain, .domainSuffix: return [.domain, .domainSuffix]
        case .ipCidr: return [.ipCidr]
        }
    }

    private func save() {
        guard !isSaving else { return }
        let input = RuleValidationInput(text: valueText, kind: kind)
        isSaving = true
        Task {
            let result = await evaluate(input)
            guard input == RuleValidationInput(text: valueText, kind: kind) else {
                isSaving = false
                return
            }
            validation = result
            isSaving = false
            guard !result.validTokens.isEmpty else {
                valuesError = tr("rules_composer_none_valid")
                return
            }
            if !isUnchangedEdit(result.validTokens) { onSave(action, kind, result.validTokens) }
            dismiss()
        }
    }

    /// 编辑已有规则而三项都没动：重写一遍只会多一次持久化，保存等同关闭。
    private func isUnchangedEdit(_ tokens: [String]) -> Bool {
        guard let editing else { return false }
        return editing.action == action && editing.kind == kind && tokens == [editing.value]
    }

    private func refreshValidation(for input: RuleValidationInput) async {
        do {
            try await Task.sleep(for: RuleProjectionTiming.debounce)
        } catch {
            return
        }
        let result = await evaluate(input)
        guard !Task.isCancelled,
              input == RuleValidationInput(text: valueText, kind: kind)
        else { return }
        validation = result
    }

    private func evaluate(_ input: RuleValidationInput) async -> RuleComposerValidation {
        await Task.detached(priority: .userInitiated) {
            RuleComposerValidation.evaluate(text: input.text, kind: input.kind)
        }.value
    }
}

private struct RuleValidationInput: Equatable, Sendable {
    let text: String
    let kind: RuleKind
}

/// 编辑器的纯校验投影；后台计算后一次性发布，避免输入时在 MainActor 重复分词和校验。
struct RuleComposerValidation: Equatable, Sendable {
    let validTokens: [String]
    let skippedCount: Int

    static func evaluate(text: String, kind: RuleKind) -> RuleComposerValidation {
        let tokens = RuleToken.parseBulk(text)
        let validTokens = tokens.filter { RuleToken.validate(kind: kind, value: $0) }
        return RuleComposerValidation(
            validTokens: validTokens,
            skippedCount: tokens.count - validTokens.count
        )
    }
}

// 动作徽章：语义色容器 + 文字（规则行与编辑器预览共用）。
struct RuleBadge: View {
    let action: RuleAction

    static func label(_ action: RuleAction) -> String {
        switch action {
        case .reject: return tr("rules_action_reject")
        case .direct: return tr("rules_action_direct")
        case .proxy: return tr("rules_action_proxy")
        }
    }

    var body: some View {
        // 代理取 `accentContainer` 底 + **`textPrimary`** 字：`accent` 压 `accentContainer`
        // 在暗色下只有 `3.44:1`，达不到普通字号门槛。
        let tone: Theme.Tone = switch action {
        case .reject: Theme.error
        case .direct: Theme.success
        case .proxy: Theme.secondaryActionOnAccent
        }
        return Text(Self.label(action))
            .font(Theme.TypeScale.badge)
            .foregroundStyle(tone.fg)
            .padding(.horizontal, RuleTagMetrics.horizontalPadding)
            .padding(.vertical, RuleTagMetrics.verticalPadding)
            .background(tone.container, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
    }
}

// 匹配类型标签（中性弱容器）。
struct RuleChip: View {
    let kind: RuleKind

    static func label(_ kind: RuleKind) -> String {
        switch kind {
        case .domain: return tr("rules_kind_domain")
        case .domainSuffix: return tr("rules_kind_suffix")
        case .ipCidr: return tr("rules_kind_cidr")
        }
    }

    var body: some View {
        // 类型标签是中性标记、不是状态：`fill` 底 + `textSecondary`。
        Text(Self.label(kind))
            .font(Theme.TypeScale.badge)
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, RuleTagMetrics.horizontalPadding)
            .padding(.vertical, RuleTagMetrics.verticalPadding)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
    }
}

/// 动作徽章与类型标签共用的内边距（两者 `10/600` + `Radius.chip`）。
enum RuleTagMetrics {
    static let horizontalPadding: CGFloat = Theme.Spacing.small
    static let verticalPadding: CGFloat = Theme.Spacing.extraSmall
}
