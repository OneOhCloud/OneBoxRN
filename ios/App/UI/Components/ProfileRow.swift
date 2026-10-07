import SwiftUI
import Core

/// 配置列表的一行：单选圈 · 名称 / 用量 · 本机用量入口。点行即切换为当前配置。
///
/// 详情、刷新、删除收在上下文菜单里（长按呼出）：行尾已经有用量入口，
/// 再并排一枚菜单图标就分不清哪个是用量、哪个是菜单；删除也本不该一眼可见。
struct ProfileRow: View {
    let profile: Profile
    let isActive: Bool
    let isBusy: Bool
    let status: ProfilesViewModel.RowStatus?
    let handlers: ProfileRowHandlers

    /// 元信息在无障碍字号下要让它换行（见下），故本行也要读字号档。
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: handlers.activate) {
            HStack(spacing: Theme.Spacing.medium) {
                ProfileRadio(isActive: isActive)
                VStack(alignment: .leading, spacing: ProfileRowMetrics.stackGap) {
                    titleLine
                    // **无障碍字号下不锁单行**：用量那一行在 AX2 起会被截掉后半段，而那半正是百分比。
                    // 常规档仍锁单行：那一档放得下，换行只会让行高跳动。
                    Text(ProfileMetaText.usage(profile))
                        .font(ProfileRowMetrics.metaFont.monospacedDigit())
                        .foregroundStyle(secondaryInk)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                // 行尾让给叠在上面的用量入口：按钮里套按钮，两端的命中规则各不相同，故入口叠放、这里只占位。
                Color.clear
                    .frame(width: ProfileRowMetrics.usageButtonSide, height: ProfileRowMetrics.usageButtonSide)
            }
            .padding(.leading, ProfileRowMetrics.leadingInset)
            .padding(.trailing, ProfileRowMetrics.trailingInset)
            .frame(maxWidth: .infinity, minHeight: ProfileRowMetrics.rowMinimumHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(ProfileListRowStyle(isSelected: isActive))
        // **忙碌态不压透明度**：名称、用量全是数据，压暗丢的是那几个数本身。
        // 标题在忙碌时已整句换成 `profiles_refreshing`，加上同一拍的禁用，「在途」已经说清楚了。
        .disabled(isBusy)
        .accessibilityAddTraits(isActive ? .isSelected : [])
        .overlay(alignment: .trailing) {
            usageButton
                .padding(.trailing, ProfileRowMetrics.trailingInset)
        }
        .contextMenuPreviewShape()
        .contextMenu { menu }
    }

    private var titleLine: some View {
        HStack(spacing: 6) {
            Text(isBusy ? tr("profiles_refreshing") : profile.name)
                .font(ProfileRowMetrics.titleFont)
                // 条件与它的对比度理由都在 `nameShowsExhausted` 上，这里不复述。
                .foregroundStyle(
                    ProfileMetaText.nameShowsExhausted(profile, isActive: isActive)
                        ? Theme.error.fg : Theme.textPrimary
                )
                .lineLimit(1)
            if let status {
                statusPill(status)
            }
        }
    }

    /// 状态药丸：`10/600`，`Radius.chip`，语义前景 + 语义容器。`5s` 后自动清除。
    private func statusPill(_ status: ProfilesViewModel.RowStatus) -> some View {
        let tone = status == .updated ? Theme.success : Theme.error
        let label = status == .updated ? tr("profiles_refresh_done") : tr("profiles_refresh_failed")
        return Text(label)
            // `10/600` 就是字阶的 `badge`。
            .font(Theme.TypeScale.badge)
            .foregroundStyle(tone.fg)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(tone.container, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
            .fixedSize()
    }

    private var usageButton: some View {
        Button(action: handlers.openUsage) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: ProfileRowMetrics.usageGlyphSize))
                .foregroundStyle(secondaryInk)
                .frame(width: ProfileRowMetrics.usageButtonSide, height: ProfileRowMetrics.usageButtonSide)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressDimmingButtonStyle())
        .accessibilityLabel(tr("settings_usage"))
    }

    @ViewBuilder
    private var menu: some View {
        Button(action: handlers.showDetail) {
            Label(tr("profiles_detail"), systemImage: "info.circle")
        }
        // 刷新在途时刷新与删除都不可点：删掉一份正在写回的配置，写回落空也不会有任何反馈。
        Button(action: handlers.refresh) {
            Label(tr("profiles_refresh"), systemImage: "arrow.clockwise")
        }
        .disabled(isBusy)
        Button(role: .destructive, action: handlers.delete) {
            Label(tr("delete"), systemImage: "trash")
        }
        .disabled(isBusy)
    }

    /// 激活行整块铺 `accentContainer`，而 `textSecondary` 压它亮色只有 `4.30` ⇒ 次级墨色随底升档。
    private var secondaryInk: Color {
        Theme.secondaryText(on: isActive ? .accentContainer : .plain)
    }
}

/// 一行能触发的全部动作。聚成一个值：五个并列闭包在调用点读不出哪个是哪个。
struct ProfileRowHandlers {
    let activate: () -> Void
    let openUsage: () -> Void
    let showDetail: () -> Void
    let refresh: () -> Void
    let delete: () -> Void
}

/// 列表卡的最后一行：导入配置。与配置行同一列起字、同一种行底。
struct ProfileImportRow: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.medium) {
                Image(systemName: "plus.circle")
                    .font(.system(size: ProfileRowMetrics.radioGlyphSize))
                    .frame(width: ProfileRowMetrics.glyphColumn)
                Text(tr("profiles_import"))
                    .font(ProfileRowMetrics.titleFont)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, ProfileRowMetrics.leadingInset)
            .frame(maxWidth: .infinity, minHeight: ProfileRowMetrics.importMinimumHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(ProfileListRowStyle(isSelected: false))
    }
}

/// 配置行的尺寸账：按触控取高。
enum ProfileRowMetrics {
    static let stackGap: CGFloat = 2
    /// 行内文字相对卡内衬再内缩的量：`6 + 10 = 16`，与页面读字边距对齐。
    static let leadingInset: CGFloat = 10
    /// 行尾只让出 `4`：用量入口自带点按框，图标离卡沿的呼吸由那个框给。
    static let trailingInset: CGFloat = 4
    static let usageButtonSide: CGFloat = 32
    static let rowMinimumHeight: CGFloat = 60
    static let importMinimumHeight: CGFloat = 52
    /// 单选圈与导入加号共用的图标列宽：两种行的文字从同一条竖线起。
    static let glyphColumn: CGFloat = 22
    static let radioGlyphSize: CGFloat = 19
    static let usageGlyphSize: CGFloat = 17
    static let titleFont = Theme.TypeScale.rowTitleEmphasis
    static let metaFont = Theme.TypeScale.subtitle
}

/// 单选圈。**实心勾是「当前配置」的非颜色通道**：选中底之外还得有一枚形状在变，
/// 否则当前项只靠一层浅色底区分。
private struct ProfileRadio: View {
    let isActive: Bool

    var body: some View {
        glyph
            .frame(width: ProfileRowMetrics.glyphColumn)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var glyph: some View {
        if isActive {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: ProfileRowMetrics.radioGlyphSize))
                .symbolRenderingMode(.palette)
                .foregroundStyle(Theme.onAccent, Theme.accent)
        } else {
            Image(systemName: "circle")
                .font(.system(size: ProfileRowMetrics.radioGlyphSize))
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

/// 列表卡里的行底。行内缩在卡里、四角露在卡内 ⇒ 底一律带 `control` 圆角（卡 `panel 18` − 内衬 `6`，同心）。
/// 当前项常驻 `accentContainer` 且不叠悬停与按下：它已是当前项，点它什么也不发生。
private struct ProfileListRowStyle: ButtonStyle {
    let isSelected: Bool
    /// 禁用的行不接悬停：点不动的行在指针下亮起来，读起来就是「这一行可以点」。
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    func makeBody(configuration: Configuration) -> some View {
        let interaction = RowInteraction(hovering: isEnabled && isHovering, pressed: configuration.isPressed)
        return configuration.label
            .background(
                isSelected ? Theme.accentContainer : interaction.fill,
                in: RoundedRectangle(cornerRadius: Theme.Radius.control)
            )
            .onHover { isHovering = $0 }
            .animation(Theme.motion(Theme.Motion.rowHover), value: isHovering)
    }
}

private extension View {
    /// 长按时抬起的那一块按行底的圆角裁，否则抬起的是一块直角矩形。
    @ViewBuilder
    func contextMenuPreviewShape() -> some View {
        contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: Theme.Radius.control))
    }
}
