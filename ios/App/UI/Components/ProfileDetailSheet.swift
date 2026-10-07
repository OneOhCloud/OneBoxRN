import SwiftUI
import Core

/// 配置详情（配置行上下文菜单的「详情」）。卡片之前是头部：站标砖、名称、主机名胶囊；
/// 其下用量与到期一张卡、链接一张卡、操作一张卡、删除单独一张卡——破坏性操作与其余操作隔开。
///
/// 只呈现 `Profile` 已有的字段，一个都不推断：服务端没下发站点（`website` 为空）时头部去产品官网，
/// 不替这份配置编一个站点。这里不复述「本机用量」——那是另一份账本、另一种口径，入口是配置行尾的用量图标。
struct ProfileDetailSheet: View {
    let vm: ProfilesViewModel
    /// 打开时的那一份。显示读活值（详情里的刷新会改写用量与到期）；
    /// 活值不在——刚在这里删掉、收起还没走完——时退回这一份，而不是把整张卡画空。
    let opened: Profile
    /// 配置没有站点时头部的去向：与关于页「官网」行同一来源。
    let productWebsite: URL

    @State private var pendingDeleteId: String?
    @State private var siteOpenFailed = false
    /// 改名草稿：nil = 不在改名。
    @State private var nameDraft: String?
    @State private var copied: CopyTarget?
    @State private var copyCount = 0
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private enum CopyTarget {
        case url
        case content
    }

    /// 「已复制」回执的驻留时长：与设置页 UA、配置页正文的复制回执同一档。
    private static let copiedFeedbackDuration: Duration = .seconds(2)

    var body: some View {
        ContentModalTitleBar(title: tr("profiles_detail")) {
            ScrollView {
                VStack(spacing: SettingsLayout.cardGap) {
                    ProfileDetailHeader(
                        profile: profile,
                        destination: destination,
                        openSite: openSite,
                        nameDraft: $nameDraft,
                        commitName: commitName
                    )
                    ProfileDetailFactsCard(profile: profile)
                    linkCard
                    actionCard
                    deleteCard
                }
                .alert(tr("settings_link_error"), isPresented: $siteOpenFailed) {}
                .pageInsets(top: Theme.Spacing.small)
                .padding(.bottom, Theme.sheetBottomInset)
            }
            .background(Theme.background)
        }
        // 详情开着时刷新失败由这里呈现：配置页那一份被详情盖着，弹不出来。
        .alert(tr("profiles_refresh_failed"), isPresented: refreshFailurePresented) {
            Button(tr("ok"), role: .cancel) { vm.dismissRefreshFailure() }
        } message: {
            if let error = vm.refreshFailure {
                Text(error.alertText)
            }
        }
    }

    private var profile: Profile { vm.profile(opened.id) ?? opened }

    private var destination: ProfileDestination {
        ProfileDestination(website: profile.website, productWebsite: productWebsite)
    }

    /// 刷新在途时刷新与删除都不可点：删掉一份正在写回的配置，写回落空也不会有任何反馈。
    private var isBusy: Bool { vm.updatingIds.contains(opened.id) }

    /// 系统浏览器打开站点；打不开时就地弹「无法打开链接」（同设置页的外链行）。
    private func openSite(_ url: URL) {
        openURL(url, completion: linkOpenCompletion { siteOpenFailed = true })
    }

    /// 回车 / 键盘「完成」即提交：草稿原样交出去，空名由 core 拒绝、名字不变；无论结局都收起编辑。
    private func commitName() {
        guard let draft = nameDraft else { return }
        nameDraft = nil
        vm.rename(opened.id, to: draft)
    }

    private var refreshFailurePresented: Binding<Bool> {
        Binding(
            get: { vm.refreshFailure != nil },
            set: { if !$0 { vm.dismissRefreshFailure() } }
        )
    }

    /// 链接可能很长：单独一张卡，任它按宽度折行，不截断。
    private var linkCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
            Text(tr("import_url_label"))
                .font(Theme.TypeScale.subtitle)
                .foregroundStyle(Theme.textSecondary)
            Text(profile.url)
                .font(Theme.TypeScale.subtitle.monospaced())
                .foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Spacing.large)
        .padding(.vertical, SettingsRowMetrics.verticalInset)
        .insetCardSurface()
    }

    private var actionCard: some View {
        ActionCard {
            ActionRow(item: copyItem(.url)) { copy(.url) }
            ActionRow(item: copyItem(.content)) { copy(.content) }
            ActionRow(item: refreshItem) { vm.update(opened.id) }
                .disabled(isBusy)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: copyCount)
        // 换 id 即取消上一轮：连点两次，回执从第二次起重新计时，不会被第一次的到点提前收掉。
        .task(id: copyCount) {
            guard copied != nil else { return }
            try? await Task.sleep(for: Self.copiedFeedbackDuration)
            guard !Task.isCancelled else { return }
            copied = nil
        }
    }

    /// 逐个写字面 key：i18n 门禁按字面量静态扫，拼出来的 key 在它眼里是零引用的死键。
    private func copyItem(_ target: CopyTarget) -> ActionItem {
        if copied == target {
            return ActionItem(label: tr("copied"), systemImage: "checkmark")
        }
        switch target {
        case .url: return ActionItem(label: tr("profiles_copy_url"), systemImage: "doc.on.doc")
        case .content: return ActionItem(label: tr("profiles_copy_content"), systemImage: "doc.on.doc")
        }
    }

    /// 内容复制存下来的原文、零改写，同配置页「导入」视图的复制。
    private func copy(_ target: CopyTarget) {
        let text = switch target {
        case .url: profile.url
        case .content: vm.content(of: opened.id)
        }
        Clipboard.write(text)
        copied = target
        copyCount += 1
    }

    /// 刷新行随这一份配置的刷新状态换字：在途、刚成功、闲置。刚失败回到闲置，错误由提示框说。
    private var refreshItem: ActionItem {
        if isBusy {
            return ActionItem(label: tr("profiles_refreshing"), systemImage: "arrow.clockwise")
        }
        if vm.rowStatus[opened.id] == .updated {
            return ActionItem(label: tr("profiles_refresh_done"), systemImage: "checkmark")
        }
        return ActionItem(label: tr("profiles_refresh"), systemImage: "arrow.clockwise")
    }

    private var deleteCard: some View {
        Button(role: .destructive) { pendingDeleteId = opened.id } label: {
            HStack(spacing: Theme.Spacing.small) {
                Image(systemName: "trash")
                    .font(.system(size: 15, weight: .medium))
                Text(tr("delete"))
                    .font(Theme.TypeScale.rowTitleEmphasis)
            }
            // 禁用时退出错误色（换色对不压透明度）。
            .foregroundStyle(isBusy ? Theme.textSecondary : Theme.error.fg)
            .frame(maxWidth: .infinity, minHeight: SettingsRowMetrics.minimumHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowStyle())
        .disabled(isBusy)
        .deleteConfirmation(tr("profiles_delete_confirm"), for: opened.id, pending: $pendingDeleteId) {
            vm.delete(opened.id)
            dismiss()
        }
        .insetCardSurface()
    }
}

/// 头部：站标砖、名称（铅笔就地改名）、主机名胶囊，居中铺在页面底色上，与关于页的应用图标同一构图。
///
/// 砖与胶囊点开去同一处。读屏只停胶囊：它带着主机名，砖再停一次就是同一个动作播两遍。
private struct ProfileDetailHeader: View {
    let profile: Profile
    let destination: ProfileDestination
    let openSite: (URL) -> Void
    @Binding var nameDraft: String?
    let commitName: () -> Void

    var body: some View {
        VStack(spacing: Theme.Spacing.medium) {
            Button { openSite(destination.url) } label: {
                ProfileMarkTile(destination: destination, metrics: .detailHeader, ground: .page)
            }
            .buttonStyle(PressDimmingButtonStyle())
            .accessibilityHidden(true)
            VStack(spacing: Theme.Spacing.small) {
                if nameDraft != nil {
                    InputField(form: .editor(label: tr("profiles_rename"), ground: .page), text: draftText, autofocus: true)
                        .submitLabel(.done)
                        .onSubmit(commitName)
                } else {
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        Text(profile.name)
                            .font(Theme.TypeScale.emptyTitle)
                            // 头部铺的是页面底色，没有激活行 `accentContainer` 的对比度问题，故超额即转色。
                            .foregroundStyle(ProfileMetaText.isExhausted(profile) ? Theme.error.fg : Theme.textPrimary)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .textSelection(.enabled)
                        Button { nameDraft = profile.name } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: ProfileDetailMetrics.renameTarget, height: ProfileDetailMetrics.renameTarget)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(tr("profiles_rename"))
                    }
                }
                Button { openSite(destination.url) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.small) {
                        Text(destination.hostname)
                            .lineLimit(1)
                        Image(systemName: "arrow.up.right")
                            .modifier(TextHeightGlyph(text: TonalCapsuleText.style))
                    }
                }
                .buttonStyle(HeaderCapsuleButtonStyle())
                .accessibilityLabel(destination.hostname)
                .accessibilityAddTraits(.isLink)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.Spacing.small)
    }

    private var draftText: Binding<String> {
        Binding(get: { nameDraft ?? "" }, set: { nameDraft = $0 })
    }
}

/// 头部胶囊：外观就是 `TonalCapsuleButtonStyle`，点按区再上下各扩一截。
/// 扩出的部分只进命中、不进版式：名称到胶囊的留白不被撑开。
private struct HeaderCapsuleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        TonalCapsuleButtonStyle().makeBody(configuration: configuration)
            .contentShape(VerticalOutsetRectangle(outset: ProfileDetailMetrics.capsuleHitOutset))
    }
}

private struct VerticalOutsetRectangle: Shape {
    let outset: CGFloat

    func path(in rect: CGRect) -> Path {
        Path(rect.insetBy(dx: 0, dy: -outset))
    }
}

/// 用量与到期卡：已用 / 总量（带配额条）、到期与上次更新。行与行之间只靠留白分开。
private struct ProfileDetailFactsCard: View {
    let profile: Profile

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: Theme.Spacing.small) {
                fact(label: tr("usage_used"), value: ProfileMetaText.usageDetail(profile))
                if profile.totalTraffic > 0 {
                    UsageGauge(used: profile.usedTraffic, total: profile.totalTraffic)
                }
            }
            .preferenceRowPadding()
            fact(label: tr("usage_expiry"), value: ProfileMetaText.expiryDetail(profile))
                .preferenceRowPadding()
            fact(label: tr("profiles_last_updated"), value: updatedAtText)
                .preferenceRowPadding()
        }
        .insetCardSurface()
    }

    /// 本地时区的日期与分钟；纪元毫秒。
    private var updatedAtText: String {
        updatedAtFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(profile.updatedAt) / 1000))
    }

    private func fact(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.medium) {
            Text(label)
                .font(Theme.TypeScale.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: Theme.Spacing.small)
            Text(value)
                .font(Theme.TypeScale.status.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }
}

private enum ProfileDetailMetrics {
    /// 胶囊可见高 `32`，上下各扩这么多，点按区到 `44`。
    static let capsuleHitOutset: CGFloat = 6
    /// 铅笔的点按区：字形只有 13，区域照行内图标列的 28 给足。
    static let renameTarget: CGFloat = 28
}

private let updatedAtFormatter = fixedFormatDateFormatter("yyyy-MM-dd HH:mm")
