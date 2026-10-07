import SwiftUI

/// 关于的**内容本体**：不带滚动容器、底色与标题，那些属于呈现方。
///
/// 呈现方是 `AboutSheet`（弹层，自绘标题条 + 关闭键）。
struct AboutContent: View {
    let vm: SettingsViewModel
    /// 「更新记录」与「关于引擎」两个入口：本页里仅有的两处会离开它的动作。
    let onOpenRefreshRecords: () -> Void
    let onOpenEngineInfo: () -> Void

    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: SettingsLayout.cardGap) {
            hero
            updateCard
            systemInfoCard
            legalCard
            refreshRecordsCard
        }
        .pageInsets(top: Theme.Spacing.small)
        .sensoryFeedback(.impact(weight: .light), trigger: vm.uaCopyCount)
    }

    /// Hero：应用 logo `72`（`Radius.panel`）+ 应用名 `22/600` + 版本 `13`。
    ///
    /// **纵向节奏是 `12 : 4`，不是一个均匀间距**：
    /// **名与版本是一组，这一组再与 logo 分开** —— 要的是比例与分组，不是那两个数本身。
    /// ⇒ 故是**两层 `VStack`**：外层 logo 与「名+版本」那一组隔 `12`，内层名与版本隔 `4`。
    /// 一个均匀 `spacing` 表达不了「分组」，它只会让三样等距。
    private var hero: some View {
        VStack(spacing: Theme.Spacing.medium) {
            // 下方紧跟应用名，读屏再念一遍 logo 只是重复。
            Image("app_logo")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: AboutMetrics.logoSide, height: AboutMetrics.logoSide)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel))
                .accessibilityHidden(true)
            VStack(spacing: Theme.Spacing.extraSmall) {
                Text(vm.appDisplayName)
                    .font(Theme.TypeScale.pageTitle)
                    .foregroundStyle(Theme.textPrimary)
                Text(tr("settings_version_build", vm.versionLabel, vm.buildNumber))
                    .font(Theme.TypeScale.status.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.Spacing.small)
    }

    /// 版本卡：全应用唯一的更新入口。无新版本时是「软件更新」+「检查更新」（本机版本 hero 里已有），检查结果写在副标题；
    /// 有新版本时胶囊外跳商店页。
    private var updateCard: some View {
        SettingsGroup(label: nil) {
            if let offer = vm.updates.offer {
                UpdateRow(
                    title: tr("update_available_title", offer.version),
                    caption: nil
                ) {
                    UpdateCapsuleButton(action: .update) { open(offer.storeUrl) }
                }
            } else {
                UpdateRow(
                    title: tr("update_section_title"),
                    caption: checkCaption
                ) {
                    UpdateCapsuleButton(
                        action: .check,
                        motion: .of(checking: vm.updates.checking, reduceMotion: reduceMotion)
                    ) { Task { await vm.updates.checkNow() } }
                    .disabled(vm.updates.checking)
                }
            }
        }
    }

    private var checkCaption: UpdateRowCaption? {
        switch vm.updates.status {
        case .idle: return nil
        case .checking: return .plain(tr("update_checking"))
        case .upToDate: return .plain(tr("update_up_to_date"))
        case .failed: return .failure(tr("update_check_failed"))
        }
    }

    /// 「系统信息」分组卡：隧道状态 / 直连 DNS / 操作系统 / 引擎版本 / User-Agent。
    ///
    /// **五行都不得省略**。
    private var systemInfoCard: some View {
        SettingsGroup(label: tr("settings_system_info")) {
            infoRow(label: tr("settings_tunnel")) { tunnelCapsule }
            infoRow(label: tr("settings_dns")) { monospacedValue(vm.dnsServer ?? "—") }
            infoRow(label: tr("settings_os_label")) { monospacedValue(PlatformIdentity.osDisplayName) }
            engineVersionRow
            infoRow(label: tr("settings_ua"), subtitle: vm.userAgent) { copyUserAgentButton }
        }
    }

    /// 「版权信息」分组卡：官网 / 隐私政策 两条外链行。
    private var legalCard: some View {
        SettingsGroup(label: tr("settings_legal_info")) {
            LinkRow(label: tr("settings_website"), systemImage: "globe") { open(vm.websiteURL) }
            LinkRow(label: tr("settings_privacy"), systemImage: "hand.raised") { open(vm.privacyURL) }
        }
    }

    /// **五行只读事实里唯一的导航行**：行上那个版本串只是引擎自陈的第一个字段，
    /// 子层（`EngineInfoScreen`）给的是整张表——`revision` 是 40 字符全长 sha（行上只是短前缀，
    /// 核对产物同源要用全长的）、`target` / `build` 回答「哪个架构、Release 还是 Debug」、
    /// `rustc` / `aws-lc` 是排 TLS 类问题要先看的依赖版本。
    /// **这一跳换的是问题本身**：行答「哪一版」，子层答「到底是哪一个二进制」。
    /// 九项里有等宽长串，塞回行内必被截断——这也是它不能退化成展示行的原因。
    ///
    /// 不用共享的 `NavRow`：本弹层五行的值是**等宽**技术值，而 `NavRow` 的
    /// 值走行骨架的比例字体。故沿用本弹层的 `infoRow`，只在尾部补 chevron 与按下反馈。
    private var engineVersionRow: some View {
        Button(action: onOpenEngineInfo) {
            infoRow(label: tr("dev_engine_label")) {
                HStack(spacing: Theme.Spacing.small) {
                    monospacedValue(vm.engineVersion)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .buttonStyle(SettingsRowStyle())
    }

    /// 更新记录入口（→ `settings.refreshRecords`）。**「先收起再推入」不在这一层**：
    /// 那是弹层形态才需要的（`AboutSheet` 在它给的回调里做），页面形态是就地推入。
    private var refreshRecordsCard: some View {
        SettingsGroup(label: nil) {
            NavRow(label: tr("dev_records_label"), systemImage: "clock.arrow.circlepath", action: onOpenRefreshRecords)
        }
    }

    private var copyUserAgentButton: some View {
        Button(action: vm.copyUserAgent) {
            Image(systemName: vm.uaCopied ? "checkmark" : "doc.on.doc")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(vm.uaCopied ? Theme.success.fg : Theme.accent)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tr(vm.uaCopied ? "copied" : "copy"))
    }

    private func monospacedValue(_ text: String) -> some View {
        Text(text)
            // 技术值取**行骨架第二行**那一档（副 `12`，等宽而不是更小），与同卡的 UA 值同档。
            .font(Theme.TypeScale.subtitle.monospaced())
            .foregroundStyle(Theme.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    /// 隧道状态胶囊：圆点 + 文字双信号，展示态无交互。
    /// 字号 `13`：卡内行骨架是 `28` 图标列 → 主标题 `15` + 副标题 `12` → **右侧 badge `13`** → chevron，
    /// 药丸就在「右侧」那一列。
    private var tunnelCapsule: some View {
        Label(
            tr(vm.connected ? "settings_running" : "settings_disconnected"),
            systemImage: vm.connected ? "circle.fill" : "circle"
        )
        .font(Theme.TypeScale.status)
        .foregroundStyle(vm.connected ? Theme.success.fg : Theme.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(vm.connected ? Theme.success.container : Theme.fill, in: Capsule())
    }

    /// 只读信息行：与可点行同一骨架，只是尾部不是 chevron。
    private func infoRow(
        label: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: () -> some View
    ) -> some View {
        HStack(spacing: Theme.Spacing.medium) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(Theme.TypeScale.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                if let subtitle {
                    // 等宽 + 截尾：截尾的正当性挂在那颗复制按钮上——
                    // `copyUserAgent` 复制的是 `vm.userAgent` 全串，不是截尾后的显示串，
                    // 故「完整值另有取回通道」成立。字号取行骨架第二行的 `12`。
                    Text(subtitle)
                        .font(Theme.TypeScale.subtitle.monospaced())
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer(minLength: Theme.Spacing.small)
            trailing()
        }
        .preferenceRowPadding()
    }

    /// 系统浏览器打开外链，失败结果回写 VM（弹「无法打开链接」）。
    private func open(_ url: URL) {
        openURL(url, completion: linkOpenCompletion { [vm] in vm.linkOpenFailed() })
    }
}

enum AboutMetrics {
    static let logoSide: CGFloat = 72
}

/// 关于的弹层外壳：内容 + 自绘标题条与关闭键。
///
/// 底色用 `background` 而不是 `surface`，好让内部的分组卡有对比——这是全仓唯一一处
/// 「弹层里再放分组卡」的版式，不给卡片再叠一层海拔。
struct AboutSheet: View {
    let vm: SettingsViewModel
    let onOpenRefreshRecords: () -> Void
    let onOpenEngineInfo: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ContentModalTitleBar(title: tr("settings_about")) {
            ScrollView {
                content.padding(.bottom, Theme.sheetBottomInset)
            }
            .background(Theme.background)
        }
    }

    /// **先收起自己再推入**：弹层盖住整屏，不收起，设置栈那一跳就被它挡在下面。
    private var content: some View {
        AboutContent(
            vm: vm,
            onOpenRefreshRecords: { dismiss(); onOpenRefreshRecords() },
            onOpenEngineInfo: { dismiss(); onOpenEngineInfo() }
        )
    }
}
