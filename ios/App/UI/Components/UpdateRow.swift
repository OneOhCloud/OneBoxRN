import SwiftUI

/// 版本行副标题：一句状态小字；失败那一档换错误色，文字本身已说清失败，不只靠颜色。
enum UpdateRowCaption: Equatable {
    case plain(String)
    case failure(String)
}

/// 关于页唯一的更新入口：一行说清「哪个版本、走到哪一步」，行尾一颗贴合内容的小胶囊做这一步的事。
///
/// 整行不可点、只有胶囊可点：行上的文字是状态，不是动作；把整行做成按钮，状态变化时
/// 用户读不出「点下去会发生什么」。胶囊由调用方给，禁用与否也由调用方声明。
/// 行首不设图标列：这一步的图标长在胶囊里，与它要做的事贴在一起。
struct UpdateRow<Action: View>: View {
    let title: String
    let caption: UpdateRowCaption?
    @ViewBuilder let action: () -> Action

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            VStack(alignment: .leading, spacing: SettingsRowMetrics.subtitleGap) {
                Text(title)
                    .font(Theme.TypeScale.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                if let caption {
                    captionText(caption)
                        .font(Theme.TypeScale.subtitle)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            // 标题与状态是同一句话：拆成两个静态文本，读屏要停两次才听完「哪个版本、走到哪一步」。
            .accessibilityElement(children: .combine)
            Spacer(minLength: Theme.Spacing.small)
            action()
        }
        .preferenceRowPadding()
    }

    private func captionText(_ caption: UpdateRowCaption) -> some View {
        switch caption {
        case .plain(let text): Text(text).foregroundStyle(Theme.textSecondary)
        case .failure(let text): Text(text).foregroundStyle(Theme.error.fg)
        }
    }
}

/// 版本行胶囊能做的那一步：文案与图标成对，三处调用方不各自挑图标。
enum UpdateRowAction: CaseIterable {
    case check
    case update
    case view
    case install
    case retry

    var titleKey: String {
        switch self {
        case .check: return "update_check_now"
        case .update: return "update_action_update"
        case .view: return "update_action_view"
        case .install: return "update_action_install"
        case .retry: return "update_action_retry"
        }
    }

    var systemImage: String {
        switch self {
        // 检查中这枚要原地转：选两条箭头中心对称的字形，墨迹重心落在几何中心上；
        // 单箭头的 `arrow.clockwise` 重心偏向箭头一侧，转起来会晃。
        case .check, .retry: return "arrow.triangle.2.circlepath"
        case .update: return "arrow.down.circle"
        case .view: return "eye"
        case .install: return "arrow.down.app"
        }
    }

    /// 图标只是装饰：可读名字就是胶囊上的文案。
    var accessibleName: String { tr(titleKey) }
}

/// 胶囊里图标的动态：只有「检查中」转，减少动态效果时静止（「检查中」的最短时长照旧，由检查方保证）。
enum UpdateCapsuleMotion: Equatable {
    case still
    case spinning

    static func of(checking: Bool, reduceMotion: Bool) -> UpdateCapsuleMotion {
        checking && !reduceMotion ? .spinning : .still
    }
}

/// 版本行行尾的胶囊：图标在文字左侧、与文字同色，尺寸与间隙由胶囊样式给，宽度贴合内容。
struct UpdateCapsuleButton: View {
    let action: UpdateRowAction
    var motion: UpdateCapsuleMotion = .still
    let perform: () -> Void

    var body: some View {
        Button(action: perform) {
            Label {
                Text(tr(action.titleKey))
            } icon: {
                UpdateCapsuleGlyph(systemImage: action.systemImage, motion: motion)
            }
        }
        .buttonStyle(TonalCapsuleButtonStyle())
        .accessibilityLabel(action.accessibleName)
    }
}

private struct UpdateCapsuleGlyph: View {
    let systemImage: String
    let motion: UpdateCapsuleMotion

    /// 转一圈的时长。
    private static let revolutionSeconds: Double = 1

    var body: some View {
        // 按时间轴算角度而不是挂 `repeatForever` 动画：后者在视图重建时会叠加或卡在半途，
        // 停转时也回不到正位。
        TimelineView(.animation(paused: motion == .still)) { context in
            UpdateCapsuleGlyphFace(systemImage: systemImage, degrees: degrees(at: context.date))
        }
        .accessibilityHidden(true)
    }

    private func degrees(at date: Date) -> Double {
        guard motion == .spinning else { return 0 }
        let turns = date.timeIntervalSinceReferenceDate / Self.revolutionSeconds
        return (turns - turns.rounded(.down)) * 360
    }
}

/// 某一角度下的图标。绕图标自身版面框的中心转；字号与对齐由胶囊样式给。
struct UpdateCapsuleGlyphFace: View {
    let systemImage: String
    let degrees: Double

    var body: some View {
        Image(systemName: systemImage)
            .rotationEffect(.degrees(degrees), anchor: .center)
    }
}
