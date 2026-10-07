import SwiftUI
import Core

// 开发者页：两个诊断开关 + 两个入口。
// 版式照设置页语法（SettingsGroup + 开关行 / 导航行），不自由发挥。
struct DevScreen: View {
    @State private var vm: DevViewModel
    private let onOpenRecords: () -> Void
    private let onOpenEngineInfo: () -> Void

    init(actions: AppActions, onOpenRecords: @escaping () -> Void, onOpenEngineInfo: @escaping () -> Void) {
        _vm = State(initialValue: DevViewModel(actions: actions))
        self.onOpenRecords = onOpenRecords
        self.onOpenEngineInfo = onOpenEngineInfo
    }

    var body: some View {
        ScrollView {
            // 卡 → 卡取 `SettingsLayout.cardGap`（`20`，UI 参考实现 `developer.tsx` 的 `mb-5`），
            // **不是通用阶梯的 `extraLarge`（24）**：那支令牌的其余调用点都不是卡 → 卡。
            VStack(spacing: SettingsLayout.cardGap) {
                // 本页开关行都带副文本：诊断开关不说清楚「它到底改了什么」就等于没有。
                SettingsGroup(label: tr("dev_fetch_label")) {
                    ToggleRow(
                        label: tr("dev_force_fallback_label"),
                        systemImage: "arrow.uturn.down",
                        // 回落 = 抓取改走另一条地址 ⇒ 网络族（同设置根的路由模式 / 区域）。
                        iconFamily: .networking,
                        subtitle: tr("dev_force_fallback_caption"),
                        isOn: vm.forceFallbackEnabled,
                        onToggle: { vm.setForceFallback($0) }
                    )
                }

                // 开关与入口拆成同组两行：一行不能既是 Toggle 又带 chevron.right，
                // 那会打破右侧图标三分语义（Toggle / chevron / 无）。
                SettingsGroup(label: tr("dev_update_label")) {
                    ToggleRow(
                        label: tr("dev_background_refresh_label"),
                        systemImage: "clock.arrow.circlepath",
                        // 信息族：它改的是**配置更新的调度**（开不开、多久一次），
                        // 不是「走哪条网络路径」—— 后者是上一行那个回落开关的判别式。
                        iconFamily: .informational,
                        subtitle: tr("dev_background_refresh_caption"),
                        isOn: vm.backgroundRefreshEnabled,
                        onToggle: { vm.setBackgroundRefresh($0) }
                    )
                    NavRow(label: tr("dev_records_label"), systemImage: "list.bullet.rectangle.portrait",
                           action: onOpenRecords)
                }

                SettingsGroup(label: tr("dev_engine_label")) {
                    // 导航到子页 ⇒ 信息族，与同组的「更新记录」同族（那一行走的就是默认值）。
                    // **不按图标认族**：`cpu` 在参考实现里属网络族，而**着色的判别式是
                    // 「这一行属于哪一族」，不是「这是哪个图标」**。
                    NavRow(label: tr("dev_engine_info_label"), systemImage: "cpu",
                           action: onOpenEngineInfo)
                }

                // 通道还活着吗：通道断了时统计页照常画旧数字、日志页停在最后一行、连接态显示已连接，
                // 应用内要有一处能回答这个问题。
                SettingsGroup(label: tr("dev_observation_label")) {
                    // 本组三行是**纯展示值行**（右侧图标三分语义里「无」那一档）
                    // ⇒ **中性族，不上色**（`textSecondary`）。
                    // 参考实现开发者页那一行的 `Binoculars` 带色，但那是打开日志窗口的导航行，
                    // 不是同一种行：着色按「这一行属于哪一族」，不按「这是哪个图标」。
                    valueRow(DevRowItem(label: tr("dev_observation_endpoint"),
                                        systemImage: "binoculars", iconFamily: .neutral),
                             value: vm.observationEndpoint)
                    valueRow(DevRowItem(label: tr("dev_observation_last_frame"),
                                        systemImage: "clock", iconFamily: .neutral),
                             value: vm.observationLastFrame)
                    valueRow(DevRowItem(label: tr("dev_observation_rebuilds"),
                                        systemImage: "arrow.triangle.2.circlepath",
                                        iconFamily: .neutral),
                             value: vm.observationRebuilds)
                }

            }
            .pageInsets(top: Theme.Spacing.large)
        }
        .screenBackground()
        .navigationTitle(tr("dev_title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    // 只读值行：无右侧图标，与开关行/导航行共存不破坏右侧图标三分语义
    // （三分说的是「Toggle / chevron / 无」，无图标那一档正是纯展示）。
    private func valueRow(_ item: DevRowItem, value: String) -> some View {
        HStack(spacing: Theme.Spacing.medium) {
            // 图标列与 `SettingsRowLabel.iconColumn` 同形，行左边才对得齐。
            SettingsIconColumn(systemImage: item.systemImage, family: item.iconFamily)
            Text(item.label)
                .font(Theme.TypeScale.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            Text(value)
                // 值 `11` **等宽数字** `textSecondary`（与其它副信息同级）。
                .font(Theme.TypeScale.meta.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, Theme.Spacing.large)
        .padding(.vertical, SettingsRowMetrics.verticalInset)
        .frame(minHeight: SettingsRowMetrics.minimumHeight)
        .accessibilityElement(children: .combine)
    }

}


/// 开发者页值行的描述。**照 `ActionItem` 的形状**——
/// 标签、图标与色族说的是同一行的同一件事。
///
/// **聚合是为了收参数个数，不是为了放宽「图标必填」那一条**：`systemImage` 在这里同样
/// **无默认值、不可选**。
private struct DevRowItem {
    let label: String
    let systemImage: String
    var iconFamily: SettingsIconFamily = .informational
}
