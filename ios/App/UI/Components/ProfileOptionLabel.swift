import SwiftUI
import Core

/// 配置切换弹层的一行：名称，下面是用量串（与配置列表行同一串，无配额时如实说没有用量数据）；
/// 行尾是到期读数，与节点弹层的延迟区同一位置。
/// 勾与选中底由 `SelectionOptionRow` 画；这里只回答「坐在什么上面」，次级字随底升档。
struct ProfileOptionLabel: View {
    let profile: Profile
    let ground: Theme.SecondaryTextSurface

    var body: some View {
        let now = Int64(Date().timeIntervalSince1970)
        HStack(spacing: Theme.Spacing.medium) {
            VStack(alignment: .leading, spacing: 0) {
                Text(profile.name)
                    .font(Theme.TypeScale.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                Text(ProfileMetaText.usage(profile))
                    .font(Theme.TypeScale.subtitle.monospacedDigit())
                    .foregroundStyle(Theme.secondaryText(on: ground))
            }
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            ExpiryTrailReadout(trail: ProfileMetaText.expiryTrail(profile, now: now), ground: ground)
        }
    }
}

/// 行尾三处的墨色：上一行日期、下一行剩余、剩余前的感叹圆。
struct ExpiryTrailInks: Equatable {
    let date: ExpiryInk
    let remaining: ExpiryInk
    /// 没有状态的档位不画感叹圆。
    let mark: ExpiryInk?
}

extension ProfileExpiryTrail {
    /// 坐在 `accentContainer` 上（选中行）字一律回正文：状态前景压它不达标。
    /// 感叹圆不随底换色（非文本图形 3:1，两种底都够），状态于是仍有图标与文字两条通道。
    func inks(on ground: Theme.SecondaryTextSurface) -> ExpiryTrailInks {
        let mark = expiry.marksWarning ? expiry.captionInk : nil
        switch ground {
        case .plain: return ExpiryTrailInks(date: .secondary, remaining: expiry.captionInk, mark: mark)
        case .accentContainer: return ExpiryTrailInks(date: .primary, remaining: .primary, mark: mark)
        }
    }
}

private struct ExpiryTrailReadout: View {
    let trail: ProfileExpiryTrail
    let ground: Theme.SecondaryTextSurface

    var body: some View {
        let inks = trail.inks(on: ground)
        VStack(alignment: .trailing, spacing: 2) {
            Text(trail.date)
                .font(Theme.TypeScale.subtitle.weight(.medium).monospacedDigit())
                .foregroundStyle(inks.date.color)
            HStack(spacing: Theme.Spacing.extraSmall) {
                if let mark = inks.mark {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(mark.color)
                }
                Text(trail.remaining)
                    .foregroundStyle(inks.remaining.color)
            }
            .font(Theme.TypeScale.note.monospacedDigit())
        }
        .lineLimit(1)
        // 各行的读数列同宽，日期才上下对齐；放大字号时列跟着变宽，不截字。
        .frame(minWidth: ExpiryTrailMetrics.width, alignment: .trailing)
        .fixedSize(horizontal: true, vertical: false)
    }
}

private enum ExpiryTrailMetrics {
    /// 放得下 `yyyy-MM-dd` 的 `12/500` 等宽数字。
    static let width: CGFloat = 76
}
