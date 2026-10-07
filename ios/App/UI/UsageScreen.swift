import SwiftUI
import Core

// 本机用量页：单个配置的账本。
// 三档分段 + 卡片（汇总 + 柱图 + 刻度，共用件 UsageChartCard）；无记录走空态，不画一排 0 值柱。
struct UsageScreen: View {
    @State private var vm: UsageViewModel
    private let profileName: String

    init(actions: AppActions, profileId: String, profileName: String) {
        _vm = State(initialValue: UsageViewModel(actions: actions, profileId: profileId))
        self.profileName = profileName
    }

    var body: some View {
        content
            .screenBackground()
            .navigationTitle(profileName)
            .navigationBarTitleDisplayMode(.inline)
            // 进入读一次；回前台再读一次。不轮询——账本每分钟才变一次。
            .task { await vm.refresh() }
    }

    /// **空态那一支不挂滚动**：`ScrollView` 把竖向约束放成无限，`EmptyState` 的「填满 + 居中」
    /// 于是塌成内容高——读起来是「贴着分段控件」而不是「在剩余视口里居中」。空态本就没有可滚的
    /// 溢出，故直接拿满剩余高度。**不要去改 `EmptyState` 共享件**：改它会把其余消费方
    /// 一起挪歪，而病根在消费方的容器（Android 侧同一机制）。
    @ViewBuilder
    private var content: some View {
        if vm.loaded && !vm.hasRecord {
            VStack(spacing: Theme.Spacing.large) {
                tierPicker
                EmptyState(
                    systemImage: "chart.line.uptrend.xyaxis",
                    title: tr("device_usage_empty"),
                    caption: tr("device_usage_empty_note")
                )
            }
            .pageInsets(top: Theme.Spacing.large)
        } else {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    tierPicker
                    UsageChartCard(series: vm.series, tier: vm.tier)
                    Text(tr("device_usage_scope_note"))
                        .font(Theme.TypeScale.meta)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .pageInsets(top: Theme.Spacing.large)
            }
        }
    }

    /// 两支共用同一个分段控件：切档在空态下同样要能点（换一档可能就有记录了）。
    private var tierPicker: some View {
        SegmentPicker(
            title: tr("settings_usage"),
            options: [
                (UsageTier.today, tr("device_usage_today")),
                (UsageTier.month, tr("device_usage_month")),
                (UsageTier.halfYear, tr("device_usage_half_year")),
            ],
            selection: Binding(get: { vm.tier }, set: { vm.select($0) })
        )
    }
}
