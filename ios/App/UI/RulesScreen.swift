import SwiftUI
import Core

// 路由规则页：RuleStore 快照驱动列表（规范序）、
// ≥12 条出现搜索、编辑器 sheet、帮助 sheet、删除确认。
struct RulesScreen: View {
    @State private var vm: RulesViewModel
    @State private var composerTarget: ComposerTarget?
    @State private var showHelp = false
    /// 规则无独立 id，三元组即身份，故直接记规则本身。
    @State private var pendingDelete: Rule?
    /// 生效说明的字号（随动态字号缩放）。**算行距要用缩放后的那个数，不是令牌里的字面值。**
    @ScaledMetric(relativeTo: .caption2) private var noteFontSize: CGFloat = 11
    /// SwiftUI **实际**用的单行高度，由隐形探针量出来。`0` = 还没量到。
    /// **这个数算不出来，只能量** —— 理由见 `TextLineHeight` 的注释。
    @State private var measuredNoteLineHeight: CGFloat = 0

    /// sheet(item:) 的目标：新增或编辑某条规则（规则无独立 id，三元组即身份）。
    private enum ComposerTarget: Identifiable {
        case add
        case edit(Rule)

        var id: String {
            switch self {
            case .add: return "add"
            case .edit(let rule): return "edit:\(rule.action.rawValue):\(rule.kind.rawValue):\(rule.value)"
            }
        }
    }

    init(actions: AppActions) {
        _vm = State(initialValue: RulesViewModel(actions: actions))
    }

    var body: some View {
        content
            .screenBackground()
            .navigationTitle(tr("rules_title"))
            .navigationBarTitleDisplayMode(.inline)
            // 顶栏只留帮助。**主操作不放工具栏**：工具栏容量取决于窗口宽度，
            // 放在这里等于挂在一个不保证存在的位置；「添加规则」的唯一入口是内容区那张操作卡。
            // 一个动作一个入口——两个入口比只有任一个都糟。
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // **有意不设字号与前景色**：`nat-type` / `speed-test` 两处同一枚 `?` 也什么都没设，
                    // 字号与着色交给工具栏自己的控件样式。
                    Button(action: { showHelp = true }) {
                        Image(systemName: "questionmark.circle")
                    }
                    .accessibilityLabel(tr("rules_help"))
                }
            }
            .sheet(item: $composerTarget) { target in
                switch target {
                case .add:
                    RuleComposer(editing: nil) { action, kind, values in
                        vm.add(action: action, kind: kind, values: values)
                    }
                case .edit(let rule):
                    RuleComposer(
                        editing: rule,
                        onSave: { action, kind, values in
                            // 编辑取首个有效值；保存按钮已按有效数 >0 门控。
                            guard let first = values.first else {
                                preconditionFailure("composer saved with no valid value")
                            }
                            vm.replace(old: rule, new: Rule(action: action, kind: kind, value: first))
                        },
                        onDelete: { pendingDelete = rule }
                    )
                }
            }
            .sheet(isPresented: $showHelp) {
                HelpSheet(
                    title: tr("rules_help_title"),
                    blocks: [
                        HelpBlock(title: tr("rules_help_actions_title"), body: tr("rules_help_actions_body")),
                        HelpBlock(title: tr("rules_help_kinds_title"), body: tr("rules_help_kinds_body")),
                        HelpBlock(title: tr("rules_help_priority_title"), body: tr("rules_help_priority_body"))
                    ]
                )
            }
            .task(id: vm.rules) {
                vm.synchronizeRules()
            }
    }

    @ViewBuilder
    private var content: some View {
        if vm.rules.isEmpty {
            emptyView
        } else {
            listView
        }
    }

    // 原生 List 承载：滑动删除交给系统 swipeActions。
    // 列表自绘装饰全关（分隔线、行背景、行内边距），页面根背景与卡片形态不变。
    // 版式与 Android 统一：**卡落在列表容器那一层**，行只给不透明 `surface` 底。
    // 这样三条要求同时成立——同处一张分组卡、原生滑动删除、条数无上界仍惰性；
    // 代价是说明 / 搜索 / 生效说明三条移出滚动区变成固定。
    private var listView: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            Text(tr("rules_caption"))
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(Theme.textSecondary)
            if vm.showsSearch {
                InputField(form: .editor(label: tr("rules_search"), ground: .page), text: Binding(
                    get: { vm.searchText },
                    set: { vm.searchText = $0 }
                ))
                .plainTextInput()
            }
            rulesCard
            ActionCard {
                ActionRow(
                    item: ActionItem(label: tr("rules_add"), systemImage: "plus"),
                    action: { composerTarget = .add }
                )
                .accessibilityIdentifier("rules.add")
            }
            Text(tr("rules_restart_note"))
                // 生效说明是**散文** ⇒ `11/400`；行高那一维（×`1.375`）与本条各管各的。
                .font(Theme.TypeScale.note)
                .foregroundStyle(Theme.textSecondary)
                .lineSpacing(noteLineSpacing)
                .background(alignment: .topLeading) {
                    LineHeightProbe(font: Theme.TypeScale.meta) { measuredNoteLineHeight = $0 }
                }
        }
        .pageInsets(top: Theme.Spacing.large)
        .contentSwapTransition(vm.rules)
    }

    /// 生效说明的行距（**行高 = 字号 × `1.375`**）。
    ///
    /// **这是第三个角色，前两个是「文本块」`1.625` 与「列表行」`1.55`** ——三个值不同不是不一致，是三个角色。
    ///
    /// **`11 × 1.375 = 15.125` 不是整数** ⇒ 走共享算式、不自行取整，否则同一个令牌会在两端漂成两个值。
    private var noteLineSpacing: CGFloat {
        TextLineHeight.spacing(fontSize: noteFontSize,
                               measuredLineHeight: measuredNoteLineHeight,
                               multiple: RulesLayout.noteLineHeightMultiple)
    }

    /// 规则行的承载容器：**这一层就是那张分组卡**（`surface` + `Radius.card`）。
    /// 列表自绘装饰全关（默认分隔线、行背景、行内边距），`swipeActions` 仍在 `List` 内，
    /// 原生滑动删除不受影响。
    private var rulesCard: some View {
        List {
            if vm.filteredRules.isEmpty {
                InlineEmptyNote(text: tr("rules_no_match"), verticalInset: Theme.Spacing.huge)
                    // 空态那一句是**非交互文本行**，它在卡里居中，
                    // 内缩取 `0` 是它自己的内容决定，不是「满幅填充」那一类的要求。
                    .textListRow(inset: 0)
            } else {
                ForEach(vm.filteredRules, id: \.self) { rule in
                    RuleRow(rule: rule, onEdit: { composerTarget = .edit(rule) })
                        .fullWidthInteractiveListRow()
                        // allowsFullSwipe: false —— 滑到底不删除，只露出动作；
                        // 删除一律经确认对话决定。不用 onDelete（IndexSet 会错位于过滤投影）。
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                pendingDelete = rule
                            } label: {
                                Label(tr("delete"), systemImage: "trash")
                            }
                        }
                        // 编辑器里点删除同样落到这里：编辑器先收起，箭头指回被编辑的那一行。
                        .deleteConfirmation(
                            tr("rules_delete_confirm"),
                            for: rule,
                            pending: $pendingDelete,
                            onConfirm: { vm.remove(rule) }
                        )
                }
            }
        }
        .listStyle(.plain)
        .listRowSpacing(0)
        .scrollContentBackground(.hidden)
        // **卡要铺满容器的 frame，不是铺到最后一行**（卡的填充与圆角加在惰性列表容器那一层）：
        // 少了这一句，`List` 的绘制只盖住整行数那一段，卡与操作卡之间露出一条页底色的空隙。
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .cardSurface()
    }

    private var emptyView: some View {
        EmptyState(
            systemImage: "arrow.triangle.branch",
            title: tr("rules_empty_title"),
            caption: tr("rules_empty_caption"),
            actionLabel: tr("rules_empty_add"),
            action: { composerTarget = .add }
        )
        // 水平边距由**页**供给（组件自身不加水平内衬，空态与同页其它内容左右对齐）。
        .padding(.horizontal, Theme.Spacing.large)
    }
}

// 规则行：动作徽章 + 类型标签 + 值（`11` 等宽，中部截断）。行内无删除按钮——
// 删除经行尾**平台原生滑动动作**（见 listView 的 swipeActions），应用不自绘手势也不自绘动作区。
private struct RuleRow: View {
    let rule: Rule
    let onEdit: () -> Void

    var body: some View {
        Button(action: onEdit) {
            HStack(spacing: Theme.Spacing.small) {
                RuleBadge(action: rule.action)
                RuleChip(kind: rule.kind)
                Text(rule.value)
                    .font(Theme.TypeScale.meta.monospaced())
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Spacing.large)
            .padding(.vertical, RulesLayout.rowVerticalPadding)
            .frame(maxWidth: .infinity, minHeight: RulesLayout.rowMinHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(RuleRowStyle())
    }
}

/// 行的底与悬停 / 按下填充：分组卡内的行靠填充分开，不靠线。
private struct RuleRowStyle: ButtonStyle {
    @State private var isHovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            // 行只给**不透明底**：卡的圆角与海拔在容器那一层，行滑开时露出的是系统画的动作区。
            // 状态层自己要圆角：本屏的行宽 `322` 内缩在 `339` 的卡里，四角落在卡内。
            // 底那层不用——它与卡同色，露出来也看不见。
            .background(
                RowInteraction(hovering: isHovering, pressed: configuration.isPressed).fill,
                in: RoundedRectangle(cornerRadius: Theme.Radius.stateLayer)
            )
            .background(Theme.surface)
            .onHover { isHovering = $0 }
            .animation(Theme.motion(Theme.Motion.rowHover), value: isHovering)
    }
}
/// 路由规则页的版式账。
enum RulesLayout {
    /// 行内边距 `16 × 12`，最小高 `52`（卡内行骨架）。
    ///
    /// **与 `SettingsRowMetrics.verticalInset` 必须同值**：两种行用两套内衬会让同一张卡里的行
    /// 看起来不属于同一族（参考实现给这两种行两套数，本仓不跟）。
    static let rowVerticalPadding: CGFloat = 12
    static let rowMinHeight: CGFloat = 52

    /// 生效说明的行高倍数。参考给的是 `leading-snug`，而本仓已把同族的 `leading-relaxed`
    /// 折成 `1.625` ⇒ **同一把尺子** ⇒ `snug` = `1.375`。
    ///
    /// **角色是「段末说明」**，与另两个不同：
    /// ```
    /// 文本块  `ConfigLayout.bodyLineHeightMultiple` = 1.625   配置正文（等宽）
    /// 列表行  `LogsLayout.rowLineHeightMultiple`    = 1.55    日志行（等宽）
    /// 段末说明 本常量                                = 1.375   非等宽的一句话
    /// ```
    /// **三个值不同不是不一致** —— 不写角色，下一个人会拿其中一个去「统一」另两个。
    static let noteLineHeightMultiple: CGFloat = 1.375
}
