import SwiftUI

// 配置查看页：版式同日志页——视图选择与复制都在工具栏，
// 内容区只有固定元信息行 + 行号等宽正文 + 浮动回到顶部胶囊；合并三态（加载 / 就绪 / 失败可重试）；
// 复制写剪贴板 + 按钮两态文案反馈；无激活 profile → 与 Home 同构的空态。
struct ConfigScreen: View {
    @State private var vm: ConfigViewModel

    init(actions: AppActions) {
        // 版本取自唯一读取口（与设置页同源，镜像 Android ConfigScreen）。
        _vm = State(initialValue: ConfigViewModel(actions: actions, engineVersion: OneBoxMApp.engineVersion))
    }

    var body: some View {
        content
            .onAppear(perform: vm.reload)
            .onDisappear(perform: vm.release)
            .screenBackground()
            .navigationTitle(tr("config_title"))
            .navigationBarTitleDisplayMode(.inline)
            // **两件尾部项并成一个 `⋯`**（照 `logs` 的解，不照 `rules` 的）。
            //
            // 不搬进内容区（`rules` 那个解）：**这两项都是「对当前视图的操作」，不是主操作**，
            // 搬进内容区会给它们过高的权重。
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if vm.importedText != nil {
                            // 视图菜单：**选中态交给 `Picker` 让平台自己画**（同日志两枚菜单）。
                            //
                            // **`selection` 用显式闭包的 Binding**：`vm.source` 是 `private(set)`，
                            // 而 `selectSource` 不只是赋值（它还重置「已复制」反馈）——
                            // **选中态的写入口只有这一个，不能绕过它直接写字段。**
                            Picker(tr("config_view_label"),
                                   selection: Binding(get: { vm.source },
                                                      set: { vm.selectSource($0) })) {
                                ForEach(ConfigViewModel.Source.allCases, id: \.self) { source in
                                    Text(tr(viewKey(source))).tag(source)
                                }
                            }
                            .pickerStyle(.inline)
                        }
                        if vm.copyableText != nil {
                            // 已复制反馈就落在按钮自身的两态文案上——不另开第二条反馈通道。
                            Section {
                                Button(action: vm.copyCurrent) {
                                    Text(tr(vm.copied ? "copied" : "copy"))
                                }
                            }
                        }
                    } label: {
                        // **锚点是图标；当前视图名在元信息行**：元信息行本来就在显示引擎版本与路由模式，
                        // 视图名落在那里。
                        Image(systemName: "ellipsis.circle")
                            .font(Theme.TypeScale.rowTitle)
                            .foregroundStyle(Theme.accent)
                    }
                    // 只显示当前值的控件，必须有一个说明它控制什么的无障碍名：
                    // 名给「是什么」、值给「现在是哪个」——只给前者会把取值从读屏里弄丢。
                    // （Android 侧的对位是 `contentDescription` + `stateDescription`。）
                    .accessibilityLabel(tr("config_view_label"))
                    .accessibilityValue(tr(viewKey(vm.source)))
                }
            }
            .sensoryFeedback(.impact(weight: .light), trigger: vm.copyCount)
            .sensoryFeedback(.selection, trigger: vm.source)
            .contentSwapTransition(vm.source)
            .contentSwapTransition(vm.mergeDisplay)
            .colorTransition(vm.copied)
    }

    @ViewBuilder
    private var content: some View {
        if vm.importedText != nil {
            VStack(spacing: Theme.Spacing.small) {
                metaLine
                bodyView
            }
            .padding(.top, Theme.Spacing.medium)
        } else {
            emptyView
        }
    }

    // 元信息块：字阶与两行结构同日志行（caption2，行距 2），固定于正文之上不随滚动。
    // 两组事实各占一行而非左右分列：窄屏下四项事实挤在一行会互相撞上并折行成一段连读的字。
    private var metaLine: some View {
        VStack(alignment: .leading, spacing: ConfigLayout.lineGap) {
            // **当前视图名落在这一行**：顶栏那枚锚点是图标，
            // 视图名由这里承担。它排在最后而不是最前 —— 这一行的既有语义是「这份配置是什么」，
            // 视图名是「我在看它的哪一面」，属于限定语。
            Text(vm.engineVersionLabel + " · " + tr(vm.modeLabelKey)
                 + " · " + tr(viewKey(vm.source)))
                .font(Theme.TypeScale.meta.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
            if vm.source == .merged, let meta = vm.mergedMeta {
                Text(tr("config_merged_meta", String(meta.injectedOutboundCount), meta.systemDns ?? "—"))
                    .font(Theme.TypeScale.meta.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Spacing.large)
    }

    private func viewKey(_ source: ConfigViewModel.Source) -> String {
        switch source {
        case .imported: return "config_view_imported"
        case .merged: return "config_view_merged"
        }
    }

    @ViewBuilder
    private var bodyView: some View {
        switch vm.source {
        case .imported:
            // 切行在后台完成后才发布；未就绪时不渲染（与合并侧的加载态同理，正文瞬间即到）。
            if let lines = vm.importedLines {
                NumberedBody(lines: lines)
            }
        case .merged:
            mergedView
        }
    }

    @ViewBuilder
    private var mergedView: some View {
        switch vm.mergeDisplay {
        case .loading:
            VStack(spacing: Theme.Spacing.large) {
                Spacer()
                ProgressView()
                    .controlSize(.large)
                Text(tr("config_merging"))
                    .font(Theme.TypeScale.status)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        case .ready(let lines, _):
            NumberedBody(lines: lines)
        case .failed(let detail):
            VStack(spacing: Theme.Spacing.large) {
                Spacer()
                StatusOrb(systemImage: "exclamationmark.triangle", tint: Theme.error.fg, container: Theme.error.container)
                Text(tr("config_merge_failed"))
                    .font(Theme.TypeScale.emptyTitle)
                    .foregroundStyle(Theme.textPrimary)
                Text(detail)
                    .font(Theme.TypeScale.subtitle.monospaced())
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.large)
                Button(tr("config_retry"), action: vm.runMerge)
                    .buttonStyle(PrimaryButtonStyle())
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
    }

    // 空态：无激活 profile（与 Home/Profiles 同构的 EmptyState 形态）。
    private var emptyView: some View {
        EmptyState(
            systemImage: "square.stack",
            title: tr("profiles_empty_title"),
            // 空态的「下一步」必须在本屏够得着或被点名：配置页那句
            // 「导入配置链接以开始使用」合格靠的是它正下方那颗按钮，而本屏在设置页深处。
            caption: tr("config_empty_caption")
        )
        // 水平边距由**页**供给（组件自身不加水平内衬，空态与同页其它内容左右对齐）。
        .padding(.horizontal, Theme.Spacing.large)
    }
}

// 行号等宽正文：行号右对齐弱化，长行换行。
// LazyVStack 逐逻辑行虚拟化：数千行非惰性全量布局会卡死滑动；
// 行数据由状态层预切分注入（状态提升），视图内零派生计算。
// 离顶 > 48 时浮出「回到顶部」胶囊。
private struct NumberedBody: View {
    let lines: TextLines

    @State private var atTop = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 正文字号（随动态字号缩放）。**算行间距要用缩放后的那个数，不是令牌里的字面值。**
    @ScaledMetric(relativeTo: .caption2) private var bodyFontSize: CGFloat = 11
    /// SwiftUI **实际**用的单行高度，由下面那个隐形探针量出来。`0` = 还没量到。
    ///
    /// **为什么必须量**：见 `ConfigLayout.bodyLineSpacing` 的注释——这个数**算不出来**。
    @State private var measuredLineHeight: CGFloat = 0

    /// 逻辑行之间与续排行之间**取同一个值**：读者分辨不出哪一行是逻辑行、哪一行是续排，
    /// 一个用户看不出区别的区分，不该产生看得出的差异。
    private var bodyLineSpacing: CGFloat {
        ConfigLayout.bodyLineSpacing(fontSize: bodyFontSize,
                                     measuredLineHeight: measuredLineHeight)
    }

    private static let topAnchor = "config-top"

    var body: some View {
        ScrollViewReader { proxy in
            virtualizedRows
            .onScrollNear(Bool.self) { geometry in
                geometry.offsetY <= 48
            } action: { _, nearTop in
                atTop = nearTop
            }
            .overlay(alignment: .bottom) {
                if !atTop, !lines.isEmpty {
                    Button {
                        if reduceMotion {
                            proxy.scrollTo(Self.topAnchor, anchor: .top)
                        } else {
                            withAnimation(.easeInOut(duration: Theme.Motion.scrollToEdge)) {
                                proxy.scrollTo(Self.topAnchor, anchor: .top)
                            }
                        }
                    } label: {
                        Label(tr("config_scroll_top"), systemImage: "arrow.up.to.line")
                    }
                    .buttonStyle(TonalCapsuleButtonStyle())
                    .padding(.bottom, Theme.Spacing.medium)
                }
            }
        }
        .contentSwapTransition(atTop)
        // 行高探针挂在**背景**上：零尺寸、零命中、无障碍不可见 ⇒ 不进版式、不进读屏。
        .background(alignment: .topLeading) {
            LineHeightProbe(font: Theme.TypeScale.meta.monospaced()) {
                measuredLineHeight = $0
            }
        }
    }

    /// 逐行虚拟化容器。
    @ViewBuilder
    private var virtualizedRows: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: bodyLineSpacing) {
                Color.clear
                    .frame(height: 1)
                    .id(Self.topAnchor)
                ForEach(lines.indices, id: \.self) { index in
                    row(index)
                }
            }
            .padding(.horizontal, Theme.Spacing.large)
        }
    }

    private func row(_ index: Int) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.medium) {
            Text(String(index + 1))
                .font(Theme.TypeScale.meta.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 28, alignment: .trailing)
            Text(lines[index])
                // 正文内容 `11` **等宽**；**行号与内容必须同档**，否则等宽正文的行网格对不齐。
                .font(Theme.TypeScale.meta.monospaced())
                // 续排行之间（长行换行续排）：**与逻辑行之间取同一个值**，同一段正文不出两种行距。
                .lineSpacing(bodyLineSpacing)
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// 配置查看页的版式账。
enum ConfigLayout {
    /// **元信息两行之间**的行距。正文行距是另一个角色（见 `bodyLineHeightMultiple`）。
    static let lineGap: CGFloat = 2

    /// 正文行高倍数（行高 = 字号 × `1.625`）。
    /// 取值依据是 UI 参考实现的 `config-viewer.tsx`：正文 `<pre>` 是 `text-[11px] leading-relaxed`，
    /// 而 `leading-relaxed` = `line-height: 1.625`。
    static let bodyLineHeightMultiple: CGFloat = 1.625

    /// 目标行高。
    static func bodyLineHeight(fontSize: CGFloat) -> CGFloat {
        fontSize * bodyLineHeightMultiple
    }

    /// 为达到那个行高要补的**行间距**。**算式在共享件里**（`TextLineHeight`）——
    /// 文本块 `1.625` / 列表行 `1.55` 两个倍数，**值不同而算法只有一套**；
    /// 为什么只能量、不能算见那份共享件。
    static func bodyLineSpacing(fontSize: CGFloat, measuredLineHeight: CGFloat) -> CGFloat {
        TextLineHeight.spacing(fontSize: fontSize, measuredLineHeight: measuredLineHeight,
                               multiple: bodyLineHeightMultiple)
    }
}
