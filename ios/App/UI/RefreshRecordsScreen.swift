import SwiftUI
import Core

// 更新记录页：单一时间线倒序，
// 点行弹任务详情。**枚举 token 原样英文呈现、不进 i18n**——它们是诊断词表，
// 翻译只会让页面与日志对不上。
struct RefreshRecordsScreen: View {
    @State private var vm: RefreshRecordsViewModel

    init(actions: AppActions) {
        _vm = State(initialValue: RefreshRecordsViewModel(actions: actions))
    }

    var body: some View {
        content
            .screenBackground()
            .navigationTitle(tr("dev_records_title"))
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $vm.detail) { detail in
                RecordDetailSheet(record: detail.record)
            }
    }

    @ViewBuilder
    private var content: some View {
        if vm.timeline.isEmpty {
            EmptyState(
                systemImage: "list.bullet.rectangle",
                title: tr("dev_records_empty"),
                caption: tr("dev_records_empty_caption")
            )
            // 水平边距由**页**供给。
            .padding(.horizontal, Theme.Spacing.large)
        } else {
            // 全部行同处一张 `surface` 卡。**卡画在惰性
            // 列表容器这一层**，行只留自己的内边距——与规则页同一个解法：塞进一个整块 item 会
            // 让几百条一次性实体化，首尾行做半圆角又会让中间行变直角。
            List(vm.timeline) { item in
                Button {
                    vm.detail = item
                } label: {
                    recordRow(item.record)
                }
                // 卡内可点的行要画悬停 / 按下填充。`.plain` 只会把
                // 内容压暗，不画行填充——而「不画线」的前提正是靠填充分开。
                // 与规则行同类：填充铺到卡沿，列表行不内缩 ⇒ 内容离卡沿的内衬由行自己给。
                .fullWidthInteractiveListRow()
            }
            .listStyle(.plain)
            .listRowSpacing(0)
            .scrollContentBackground(.hidden)
            .cardSurface()
            .pageInsets(top: Theme.Spacing.large)
        }
    }

    private func recordRow(_ record: RefreshRecord) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.profileName.isEmpty ? (record.profileId.isEmpty ? "—" : record.profileId) : record.profileName)
                    .font(Theme.TypeScale.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                Text(RecordFormat.timestamp(record.occurredAtMillis))
                    .font(Theme.TypeScale.meta.monospaced())
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(record.outcome.rawValue)
                    // 结局 `11` **等宽**。
                    .font(Theme.TypeScale.meta.monospaced())
                    .foregroundStyle(outcomeColor(record.outcome))
                Text(record.route.rawValue)
                    .font(Theme.TypeScale.meta.monospaced())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .preferenceRowPadding()
        .contentShape(Rectangle())
    }

    private func outcomeColor(_ outcome: RefreshRecordOutcome) -> Color {
        switch outcome {
        // 成功前景，不是 `accent`——那是可点标签的颜色，
        // 拿它表达「成功」会让这一列与页面上的可点元素混成一类。
        case .updated: Theme.success.fg
        case .dropped: Theme.textSecondary
        case .failed: Theme.error.fg
        }
    }
}

private struct RecordDetailSheet: View {
    let record: RefreshRecord

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                // 弹层标题 `15/600`：调用点组合，不新立令牌——`rowTitle`（15）+ `.weight(.semibold)`
                // 就是它（先例见 `AboutSheet` 标题栏）。**不居中**：标题按阅读方向起始边对齐，居中是例外。
                ContentModalHeading(text: tr("dev_record_detail_title"),
                                    font: Theme.TypeScale.rowTitle.weight(.semibold))
                // 空字段整行省略，不展示占位。
                ForEach(RecordFormat.detailFields(record), id: \.0) { label, value in
                    if !value.isEmpty {
                        HStack(alignment: .firstTextBaseline) {
                            Text(label)
                                .font(Theme.TypeScale.control)
                                .foregroundStyle(Theme.textSecondary)
                            Spacer()
                            Text(value)
                                .font(Theme.TypeScale.control.monospaced())
                                .foregroundStyle(Theme.textPrimary)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
            }
            .padding(Theme.Spacing.large)
        }
        .screenBackground()
    }
}

// 字段名与 RefreshRecord 的字段一一对应，英文原样——与记录里的 token 同一方言。
// 与 Android RefreshRecordsScreen.detailFields 逐条对应。
enum RecordFormat {
    static func detailFields(_ record: RefreshRecord) -> [(String, String)] {
        [
            ("time", timestamp(record.occurredAtMillis)),
            ("profile", record.profileName),
            ("profileId", record.profileId),
            ("trigger", record.trigger.rawValue),
            ("outcome", record.outcome.rawValue),
            ("contentChanged", record.contentChanged ? "true" : "false"),
            ("duration", "\(record.durationMillis) ms"),
            ("route", record.route.rawValue),
            ("denial", record.denial?.rawValue ?? ""),
            ("error", record.errorToken),
            ("used", "\(record.usedTraffic)"),
            ("total", "\(record.totalTraffic)"),
            ("expire", record.expireTime > 0 ? expiry(record.expireTime) : ""),
        ]
    }

    // 经唯一构造点（FixedDateFormat）：不钉 locale 的 DateFormatter 会跟随环境日历，
    // 同一纪元秒在伊朗会格式化成波斯历，与 Android 的 Locale.US 全不对齐。
    static func timestamp(_ millis: Int64) -> String {
        fixedFormatDateFormatter("yyyy-MM-dd HH:mm:ss")
            .string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    static func expiry(_ epochSeconds: Int64) -> String {
        fixedFormatDateFormatter("yyyy-MM-dd")
            .string(from: Date(timeIntervalSince1970: Double(epochSeconds)))
    }
}
