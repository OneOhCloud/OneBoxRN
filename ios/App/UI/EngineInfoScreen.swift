import SwiftUI
import Core

// 关于引擎：引擎名与版本两行固定，
// 其余是引擎自陈的有序键值对——键是英文 token，原样呈现不翻译（与日志行同类）。
// 版本取构建期注入值（两端同源 engine/Makefile），App 进程不加载引擎。
struct EngineInfoScreen: View {
    private let vm: EngineInfoViewModel

    /// 行内可用宽（卡宽 − 行内水平内边距 × 2）。`0` = 还没量到。
    @State private var rowContentWidth: CGFloat = 0

    init() {
        vm = EngineInfoViewModel()
    }

    var body: some View {
        ScrollView {
            // **全部行同处一张卡**：固定两行 engine / version
            // 之后直接接引擎自陈的键值对，中间不另起一张卡。
            // 区段小标题取 `dev_engine_label`（「引擎」）：有卡就有各自的区段小标题，
            // 名字是那张卡的，不是这一屏的。**不取页标题那个键**：两者取值相同，对调过来是隐形的。
            SettingsGroup(label: tr("dev_engine_label")) {
                infoRow(label: "engine", value: vm.info.name)
                infoRow(label: "version", value: vm.info.version)
                ForEach(vm.info.entries, id: \.key) { entry in
                    infoRow(label: entry.key, value: entry.value)
                }
            }
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width - Theme.Spacing.large * 2
            } action: { width in
                rowContentWidth = width
            }
            .pageInsets(top: Theme.Spacing.large)
        }
        .screenBackground()
        .navigationTitle(tr("dev_engine_info_title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// **键与值各占一栏定宽**（键 `1` 份、值 `2` 份、间隔 `12`）。
    ///
    /// **不要写成「键 + `Spacer()` + 值」**：引擎自陈里 `revision`
    /// 是 40 字符的十六进制，被弹性空白顶到右边之后，它换行的第二段会直接贴到键上；
    /// 而且「内容窄就缩」会让右对齐的值逐行停在不同的 x 上。
    ///
    /// 两栏宽度由量出的卡宽反算（`rowContentWidth`）：SwiftUI 没有 Compose 的 `weight`，
    /// `maxWidth: .infinity` 只能给到 1:1。还没量到那一帧退回自然布局，不会出现零宽。
    private func infoRow(label: String, value: String) -> some View {
        let gap = Theme.Spacing.medium
        let keyWidth = rowContentWidth > 0 ? (rowContentWidth - gap) / 3 : nil
        return HStack(alignment: .firstTextBaseline, spacing: gap) {
            Text(label)
                .font(Theme.TypeScale.rowTitle)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: keyWidth, alignment: .leading)
            Text(value)
                .font(Theme.TypeScale.meta.monospaced())
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
                .frame(width: keyWidth.map { $0 * 2 }, alignment: .trailing)
                .textSelection(.enabled)
        }
        .padding(.horizontal, Theme.Spacing.large)
        .padding(.vertical, SettingsRowMetrics.verticalInset)
        .frame(minHeight: SettingsRowMetrics.minimumHeight)
    }
}
