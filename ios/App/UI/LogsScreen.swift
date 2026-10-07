import SwiftUI
import Core

// 日志页：工具栏来源/级别两枚菜单、等宽正文、
// 贴底自动跟随 + 离底「回到最新」胶囊、清空（轻触感，过滤保持当前来源）、双空态。
struct LogsScreen: View {
    @State private var vm: LogsViewModel
    @State private var atBottom = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let bottomAnchor = "logs-bottom"

    init(store: LogStore) {
        _vm = State(initialValue: LogsViewModel(store: store))
    }

    var body: some View {
        // 两段筛选改用 `Picker` 之后要拿 `$vm.…` 的绑定（同 `SettingsScreen` 的写法）。
        @Bindable var vm = vm
        return content
            .screenBackground()
            .navigationTitle(tr("logs_title"))
            .navigationBarTitleDisplayMode(.inline)
            // 三件尾部操作合成**一个**溢出入口，用中性的 `⋯` 而不是「筛选」：**清空不是筛选**，拿一个盖不住它的名字去命名，
            // 既误导也把一个破坏性动作藏进了听起来无害的词里。故菜单内分段：两段筛选（各自
            // 带 checkmark），清空单独一段、破坏性样式。
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        // **选中态交给 `Picker` 让平台自己画**。
                        Picker(tr("logs_source_label"), selection: $vm.filter) {
                            ForEach(LogsViewModel.SourceFilter.allCases, id: \.self) { source in
                                Text(tr(sourceKey(source))).tag(source)
                            }
                        }
                        .pickerStyle(.inline)
                        Picker(tr("logs_level_label"), selection: $vm.levelFilter) {
                            ForEach(LogsViewModel.levelOptions, id: \.self) { level in
                                Text(tr(levelKey(level))).tag(level)
                            }
                        }
                        .pickerStyle(.inline)
                        if !vm.isEmpty {
                            Section {
                                Button(role: .destructive, action: vm.clear) {
                                    Text(tr("logs_clear"))
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(Theme.TypeScale.rowTitle)
                            .foregroundStyle(Theme.accent)
                    }
                    .accessibilityLabel(tr("logs_more"))
                }
            }
            .sensoryFeedback(.impact(weight: .light), trigger: vm.clearCount)
            .sensoryFeedback(.selection, trigger: vm.levelFilter)
            .contentSwapTransition(vm.isEmpty)
    }

    @ViewBuilder
    private var content: some View {
        if vm.isEmpty {
            emptyView
        } else {
            logView
        }
    }

    private var logView: some View {
        let filteredEntries = vm.filteredEntries
        return VStack(spacing: LogsLayout.searchToList) {
            searchRow
            ScrollViewReader { proxy in
                virtualizedRows(filteredEntries)
                .onScrollNear(Bool.self) { geometry in
                    geometry.offsetY + geometry.containerHeight
                        >= geometry.contentHeight - 48
                } action: { _, nearBottom in
                    atBottom = nearBottom
                }
                // 自动跟随：贴底时新行到达即滚到底；离底暂停（胶囊承担恢复）。
                // Store 按批发布；键取当前投影末项 id，别源或低于呈现档的批次不触发无效滚动。
                .onChange(of: filteredEntries.last?.id) {
                    if atBottom {
                        proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                    }
                }
                .overlay(alignment: .bottom) {
                    if !atBottom, !filteredEntries.isEmpty {
                        Button {
                            if reduceMotion {
                                proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                            } else {
                                withAnimation(.easeInOut(duration: Theme.Motion.scrollToEdge)) {
                                    proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                                }
                            }
                        } label: {
                            Label(tr("logs_follow"), systemImage: "arrow.down.to.line")
                        }
                        .buttonStyle(TonalCapsuleButtonStyle())
                        // 胶囊按与内容同一份避让量抬起（由导航壳统一算），故与 dock 不叠。
                        .padding(.bottom, LogsLayout.followPillLift)
                        .transition(.opacity)
                    }
                }
                .onAppear {
                    proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                }
            }
        }
        .padding(.top, LogsLayout.topInset)
        .contentSwapTransition(atBottom)
    }

    /// 逐行虚拟化容器。
    @ViewBuilder
    private func virtualizedRows(_ entries: [LogEntry]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: LogsLayout.rowGap) {
                if entries.isEmpty {
                    noMatchRow
                } else {
                    ForEach(entries) { entry in
                        LogRow(entry: entry)
                    }
                }
                Color.clear
                    .frame(height: 1)
                    .id(Self.bottomAnchor)
            }
            .padding(.horizontal, Theme.Spacing.large)
        }
    }

    /// 关键词搜索行：常驻列表之上。
    ///
    /// 不用 `.searchable`：那在 iOS 是下拉才露出；
    /// 而关键词是自由文本、没有可当锚点的短标签，「当前是否在过滤」必须一眼可见。
    private var searchRow: some View {
        // 外观、圆角、高度全部由共享输入组件给：本页只给它对齐列表的水平边距。
        InputField(
            form: .search(clearLabel: tr("logs_search_clear")),
            text: $vm.keyword,
            placeholder: tr("logs_search_placeholder")
        )
        .padding(.horizontal, Theme.Spacing.large)
    }

    private var noMatchRow: some View {
        InlineEmptyNote(text: tr("logs_no_match"), verticalInset: Theme.Spacing.huge)
    }

    private var emptyView: some View {
        EmptyState(
            systemImage: "text.alignleft",
            title: tr("logs_empty_title"),
            caption: tr("logs_empty_caption")
        )
        // 水平边距由**页**供给（组件自身不加水平内衬，空态与同页其它内容左右对齐）。
        .padding(.horizontal, Theme.Spacing.large)
    }
}

// 来源的 i18n 键。
private func sourceKey(_ source: LogsViewModel.SourceFilter) -> String {
    switch source {
    case .engine: return "logs_filter_engine"
    case .app: return "logs_filter_app"
    }
}

// 级别档的 i18n 键（可选五档；fatal/panic 不可选，到达即编程错误）。
private func levelKey(_ level: LogLevel) -> String {
    switch level {
    case .trace: return "logs_level_trace"
    case .debug: return "logs_level_debug"
    case .info: return "logs_level_info"
    case .warn: return "logs_level_warn"
    case .error: return "logs_level_error"
    case .fatal, .panic: preconditionFailure("level \(level) is not selectable")
    }
}

// 时间列固定 HH:mm:ss（等宽对齐；日历与数字字形由 fixedFormatDateFormatter 钉死）。
private let logTimeFormatter = fixedFormatDateFormatter("HH:mm:ss")

// 日志行：级别列 + 时间 + 等宽正文（来源由所选过滤段表达，行内不重复）。
// 整行可点即复制；复制后短暂着底色，只改背景不改布局，避免位置偏移。

/// 日志行的四档优先级链：**复制成功 > 按下 > 悬停 > 透明**。
///
/// **这一族必须走 `ButtonStyle`**：按下那一档只有 `ButtonStyle` 拿得到（`isPressed`），
/// 不是 `Button` 的可点行会静默地不带交互态——`.onTapGesture` 拿不到 `isPressed`。
private struct LogRowStyle: ButtonStyle {
    let copied: Bool
    @State private var isHovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, Theme.Spacing.small)
            .padding(.vertical, Theme.Spacing.extraSmall)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())   // 命中区为整行，包括两列之间的空白
            // 复制反馈是一块 `Radius.control` 的**圆角块**，不是通栏矩形。
            // 只改背景不改布局，避免任何位置偏移。
            .background(fill(RowInteraction(hovering: isHovering, pressed: configuration.isPressed)),
                        in: RoundedRectangle(cornerRadius: Theme.Radius.control))
            .onHover { isHovering = $0 }
            .animation(Theme.motion(Theme.Motion.rowHover), value: isHovering)
    }

    /// 复制成功压过交互态：那一闪是对刚发生的动作的回执，比「手指停在上面」更该被看见。
    ///
    /// **入参是交互态本身，不是一个 `pressed` 开关**：`hovering` 与 `pressed` 描述的是同一件事
    /// （这一行此刻的交互态），把它拆成布尔标志正是「函数做了不止一件事」的形状。
    private func fill(_ interaction: RowInteraction) -> Color {
        copied ? Theme.success.container : interaction.fill
    }
}

private struct LogRow: View {
    let entry: LogEntry

    /// 复制反馈时长。
    private static let copiedFeedbackDuration: Duration = .seconds(1)
    /// 级别列宽：容得下最长 token（`PANIC` / `TRACE` / `DEBUG` / `ERROR` 五字符）。
    private static let levelColumnWidth: CGFloat = 42


    @State private var copied = false
    @State private var copyCount = 0

    var body: some View {
        Button(action: copy) {
            rowContent
        }
        .buttonStyle(LogRowStyle(copied: copied))
        .sensoryFeedback(.impact(weight: .light), trigger: copyCount)
        // 回落绑定视图生命周期：裸 `Task` 无句柄也不取消，连点会由旧任务提前清掉新反馈，
        // 行离场后还继续改状态。`task(id:)` 在 id 变化与离场时自动取消。
        // 键取**次数**而非 `copied`：连点时 `copied` 恒为 true，键不变则计时器不重启，
        // 第二次复制的反馈会被第一次的计时器掐断（与 Android `LaunchedEffect(copyCount)` 同形）。
        .task(id: copyCount) {
            guard copyCount > 0 else { return }
            copied = true
            try? await Task.sleep(for: Self.copiedFeedbackDuration)
            guard !Task.isCancelled else { return }
            copied = false
        }
        // **不再手写 `.isButton` 与 `.accessibilityAction(.default,)`**：这一行现在真的是 `Button`，
        // 两者都由它自带。手写那两句的旧理由（`accessibilityAction(named:)` 只进转子的自定义动作
        // 列表、VoiceOver 双击不触发它）**仍然成立**，只是它描述的是「非 `Button` 元素要自己补」那条路。
        // hint 对应 Android `clickable(onClickLabel = …)`——同为主操作的朗读提示。
        .accessibilityHint(Text(tr("copy")))
    }

    /// 正文字号（随动态字号缩放）。**算行距要用缩放后的那个数，不是令牌里的字面值。**
    @ScaledMetric(relativeTo: .caption2) private var lineFontSize: CGFloat = 11
    /// SwiftUI **实际**用的单行高度，由隐形探针量出来。`0` = 还没量到。
    /// **这个数算不出来，只能量** —— 理由见 `TextLineHeight` 的注释。
    @State private var measuredLineHeight: CGFloat = 0

    /// 日志行的行距（**行高 = 字号 × `1.55`**）。
    ///
    /// **这是「列表行」那一档** —— 配置查看的正文是**文本块**那一档（`1.625`）。
    /// **两个值不同不是不一致，是两个角色**。
    private var lineSpacing: CGFloat {
        TextLineHeight.spacing(fontSize: lineFontSize,
                               measuredLineHeight: measuredLineHeight,
                               multiple: LogsLayout.rowLineHeightMultiple)
    }

    private var rowContent: some View {
        // 两行之间（同一行内的元信息行 ↔ 正文行）与续排行之间取同一个值。
        VStack(alignment: .leading, spacing: lineSpacing) {
            HStack(spacing: 6) {
                Text(entry.level.token.uppercased())
                    .font(Theme.TypeScale.meta.monospaced())
                    .foregroundStyle(Self.levelTone(entry.level))
                    .frame(width: Self.levelColumnWidth, alignment: .trailing)
                Text(logTimeFormatter.string(from: entry.time))
                    .font(Theme.TypeScale.meta.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
            // 元信息行与正文行同为 `11` 等宽。错误行正文转错误前景，
            // 不再另加错误胶囊——级别列已携带更强信息。
            Text(entry.message)
                .font(Theme.TypeScale.meta.monospaced())
                // 续排行之间（日志正文会换行）。
                .lineSpacing(lineSpacing)
                .foregroundStyle(entry.isError ? Theme.error.fg : Theme.textPrimary)
        }
        // 行高探针挂在**背景**上：零尺寸、零命中、无障碍不可见 ⇒ 不进版式、不进读屏。
        .background(alignment: .topLeading) {
            LineHeightProbe(font: Theme.TypeScale.meta.monospaced()) { measuredLineHeight = $0 }
        }
    }

    /// 与平台日志设施镜像同形，粘贴后仍能分辨级别。
    private func copy() {
        let text = "\(logTimeFormatter.string(from: entry.time)) [\(entry.level.token)] \(entry.message)"
        Clipboard.write(text)
        copyCount += 1
    }

    private static func levelTone(_ level: LogLevel) -> Color {
        if level >= .error { return Theme.error.fg }
        if level == .warn { return Theme.warning.fg }
        return Theme.textSecondary
    }
}

/// 日志页的版式账。
enum LogsLayout {
    /// 日志行的行高倍数。
    /// **列表行**那一档；文本块那一档是 `1.625`——**两个角色两个值**。
    static let rowLineHeightMultiple: CGFloat = 1.55

    static let topInset: CGFloat = Theme.Spacing.medium
    /// 搜索行与列表之间。
    static let searchToList: CGFloat = Theme.Spacing.medium
    /// 行间距——行与行之间靠它分开，**不画分隔线**。
    static let rowGap: CGFloat = Theme.Spacing.small
    /// 跟随胶囊的抬起量：与内容底部避让同一档，故它落在 dock 之上而不与之重叠。
    static let followPillLift: CGFloat = Theme.Spacing.medium
}
