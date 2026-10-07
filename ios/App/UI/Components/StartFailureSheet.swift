import SwiftUI
import Core

// 启动失败弹层：
// 数据来自 EngineError（token 语言无关，文案在此映射）。
// 两条入口共用本组件——AppNav 在诊断由空转非空时自动弹出，HomeScreen 底部失败胶囊手动打开。
// 复制写入系统剪贴板并给触感反馈。
struct StartFailureSheet: View {
    let error: EngineError
    /// nil = 无可信时刻（挂载读到的历史失败）→ 时间行占位「—」，不填当前时间。
    let occurredAt: Date?
    let configFingerprint: String?
    /// 诊断来源。**由登记方记下，本层只读不猜**；nil = 没记下 ⇒ 占位「—」。
    let source: FailureSource?

    @State private var expanded = false
    @State private var copied = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.large) {
                Text(tr("failure_title"))
                    .font(Theme.TypeScale.sheetTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, SheetInset.textExtra)
                    .padding(.top, Theme.Spacing.large)
                VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                    Text(tr("failure_token_label"))
                        .font(Theme.TypeScale.subtitle)
                        .foregroundStyle(Theme.textSecondary)
                    Text(error.token)
                        .font(Theme.TypeScale.status.monospaced())
                        .foregroundStyle(Theme.error.fg)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .blockInset()
                .background(Theme.error.container, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    MetaRow(label: tr("failure_time_label"), value: timeText)
                    MetaRow(label: tr("failure_source_label"), value: Self.sourceText(source))
                    MetaRow(label: tr("failure_fingerprint_label"), value: fingerprintText)
                }
                .blockInset()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
                Button(action: { expanded.toggle() }) {
                    Label(
                        tr(expanded ? "failure_collapse" : "failure_expand"),
                        systemImage: expanded ? "chevron.up" : "chevron.down"
                    )
                    .font(Theme.TypeScale.controlEmphasis)
                    .foregroundStyle(Theme.accent)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                if expanded {
                    VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                        Text(tr("failure_detail_label"))
                            .font(Theme.TypeScale.subtitle)
                            .foregroundStyle(Theme.textSecondary)
                        // 树形而不是一行串到底：段与段的层级在 core 分好（`DiagnosisDetail`），
                        // 这里只画。读法同崩溃栈——首行是结局，下面各行是它的旁证。
                        Text(DiagnosisDetail.tree(error.detail ?? ""))
                            .font(Theme.TypeScale.subtitle.monospaced())
                            .foregroundStyle(Theme.textPrimary)
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .blockInset()
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
                }
                // 不设「窄了退回竖排」那种条件形态；放不放得下由 `FailureActionRowWidthTests` **两语各量一遍**回答。
                ButtonRow {
                    Button(action: copyDiagnostics) {
                        Label(
                            tr(copied ? "failure_copied" : "failure_copy"),
                            systemImage: copied ? "checkmark" : "doc.on.doc"
                        )
                    }
                    .buttonStyle(SecondaryButtonStyle(tone: copied ? Theme.success : Theme.secondaryAction))
                    // 复制 = light；只在进入已复制态时发，回落不发。
                    .sensoryFeedback(.impact(weight: .light), trigger: copied) { _, isCopied in isCopied }
                    Button(tr("failure_dismiss")) { dismiss() }
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(.horizontal, SheetInset.panel)
            // 内容底部取 `sheetBottomInset`：
            // 弹层内容可滚动，缺它时底部动作区直接贴弹层下沿。
            .padding(.bottom, Theme.sheetBottomInset)
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
        // 抽屉不是「内容替换」，是同一份内容的高度在变：时长表「展开抽屉高度」是 `220ms`
        //，与 `ProfileRow` 的展开同形，故直接取那一档而不是走内容替换的 `300`。
        .animation(reduceMotion ? nil : Theme.motion(Theme.Motion.drawerHeight), value: expanded)
    }

    private var timeText: String { failureTimeText(occurredAt) }

    /// 来源那一行的文案。诊断阶梯里只有第 1 级是引擎：隧道进程留下的阶段标记、
    /// App 自己判定的启动预算到点与合并失败都不是引擎报的，故按来源逐一出文案；
    /// 只有 `.none`（登记方没记下）占位。
    ///
    /// 逐个写字面 key 而不是拼 `"failure_source_" + token`：i18n 门禁按字面量静态扫，
    /// 拼出来的 key 在它眼里是零引用的死键。
    static func sourceText(_ source: FailureSource?) -> String {
        switch source {
        case .engine: return tr("failure_source_engine")
        case .tunnel: return tr("failure_source_tunnel")
        case .app: return tr("failure_source_app")
        case .system: return tr("failure_source_system")
        case .diagnostics: return tr("failure_source_diagnostics")
        // `.none` 单独一臂：「登记方没记下」与「记了一档」不是一回事。
        case .none: return failureTimePlaceholder
        }
    }

    /// 无激活 profile / 内容为空时没有指纹可言，占位而不编造（同 stats 页不把 0 改写为「—」的反面：此处确无值）。
    private var fingerprintText: String { configFingerprint ?? "—" }

    private func copyDiagnostics() {
        Clipboard.write(
            failureDiagnosticsText(error: error, occurredAt: occurredAt, configFingerprint: configFingerprint)
        )
        copied = true
    }
}

/// 三个块的块内边距：**水平 `12` · 垂直 `10`**（三个块一律 `Radius.control`）。
///
/// 单独收成一个修饰符：错误标识块 / 元信息块 / 展开后的诊断详情块三处共用。
/// 垂直那档 `10` **在 `Theme.Spacing` 里没有对应档**（`small 8` / `medium 12`），
/// 故就地给数；**不要把它四舍五入到 `8` 或 `12` 去凑令牌**。
private extension View {
    func blockInset() -> some View {
        padding(.horizontal, Theme.Spacing.medium)
            .padding(.vertical, StartFailureMetrics.blockVerticalInset)
    }
}

private enum StartFailureMetrics {
    static let blockVerticalInset: CGFloat = 10
}

/// 无值即占位，不编造：挂载读到的历史失败没有可信时刻。
let failureTimePlaceholder = "—"

// 失败时刻固定 `yyyy-MM-dd HH:mm:ss`（与 Android FailureSheet 逐字同形）。
private let failureTimeFormatter = fixedFormatDateFormatter("yyyy-MM-dd HH:mm:ss")

func failureTimeText(_ occurredAt: Date?) -> String {
    guard let occurredAt else { return failureTimePlaceholder }
    return failureTimeFormatter.string(from: occurredAt)
}

/// 复制给用户带走的诊断文本：字段与顺序两端逐字相同；`detail` 无值时整行不出现，
/// 不产出 `detail:` 空行——粘贴到求助会话里的空字段只会让人以为诊断被截断了。
func failureDiagnosticsText(error: EngineError, occurredAt: Date?, configFingerprint: String?) -> String {
    var lines = [
        "token: \(error.token)",
        "time: \(failureTimeText(occurredAt))",
        "config: \(configFingerprint ?? failureTimePlaceholder)",
    ]
    // 复制出去的也是树形：粘到求助会话里的那份与用户屏幕上看到的必须是同一个形状，
    // 否则对方读到的层级与提问者描述的对不上。
    if let detail = error.detail { lines.append("detail: \(DiagnosisDetail.tree(detail))") }
    return lines.joined(separator: "\n")
}

// 诊断元信息行：标签 + 等宽值（与 HomeScreen mock 弹层同形态；mock 删除时合并为唯一实现）。
private struct MetaRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(Theme.TypeScale.meta)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .font(Theme.TypeScale.meta.monospaced())
                .foregroundStyle(Theme.textPrimary)
        }
    }
}
