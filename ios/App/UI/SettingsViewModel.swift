import Foundation
import Observation
import Core

/// 关于外链：装配期注入的两条外跳 URL；注入缺失在装配处 require 即崩。
struct AboutLinks {
    let website: URL
    let privacy: URL
}

// 设置页真实驱动：只读状态汇总（隧道 / DNS / UA）+ 区域选择 + 外链地址 + 版本页脚。
// 外链的「打开」动作在视图层（@Environment(\.openURL)），本层只出地址并接收失败结果。
// 持久化写入只有区域一处：UA 复制只写系统剪贴板，build 号切换为会话内存态。
@MainActor
@Observable
final class SettingsViewModel {
    /// 「已复制」短暂反馈时长（与配置查看页复制反馈同节奏）。
    private static let copiedFeedbackDuration: Duration = .seconds(2)

    private let actions: AppActions

    /// 唯一 UA 构造文件产出，与导入/刷新实发同源同值。
    var userAgent: String { UserAgent.build(engineVersion: engineVersion) }

    private(set) var showBuildNumber = false
    private(set) var uaCopied = false
    private(set) var uaCopyCount = 0
    private(set) var dnsServer: String?

    /// 外链领域错误呈现：外链无法打开 → 提示并留在设置页。
    var linkErrorVisible = false
    var onDemandErrorVisible = false

    @ObservationIgnored private var copyRevertTask: Task<Void, Never>?

    init(actions: AppActions) {
        self.actions = actions
    }

    /// 运行状态随隧道连接真相呈现；本页不产生也不改变它。
    var connected: Bool { actions.connected }

    /// 当前区域（持久化唯一读取在 AppActions.RegionPreference）。
    var region: Region { actions.region }

    /// 当前路由模式（持久化唯一读写处在 AppActions.RoutingModePreference）。
    var routingMode: RoutingMode { actions.routingMode }

    /// 切换 = 立即持久化 + restartIfRunning。
    func selectRoutingMode(_ value: RoutingMode) {
        guard value != routingMode else { return }
        Task { try? await actions.setRoutingMode(value) }
    }

    /// 区域切换 = 只持久化（纯占位设置，无重启、无合并变化）。
    func selectRegion(_ value: Region) {
        actions.setRegion(value)
    }

    /// iOS 保活入口；配置失败在设置页短提示，不改变连接状态。
    var onDemandEnabled: Bool { actions.onDemandEnabled }

    /// 「包含所有网络」开着时本开关强制为真且不可关——关掉它就造出一个
    /// 「接管开着、隧道断着、没人拉得回来」的断网稳定态。禁用而非隐藏：让用户看得见它是开的。
    var onDemandLocked: Bool { !actions.canDisableOnDemand }

    func setOnDemandEnabled(_ enabled: Bool) {
        guard enabled != onDemandEnabled else { return }
        Task {
            do {
                if enabled {
                    try await actions.enableOnDemand()
                } else {
                    try await actions.disableOnDemand()
                }
            } catch {
                onDemandErrorVisible = true
            }
        }
    }

    /// 网络包含范围（持久化唯一读写处在 NetworkInclusionStore，经 actions 观察）。
    var networkInclusion: NetworkInclusion { actions.networkInclusion }

    /// 切换立即持久化并重启生效（重启失败诊断经全局失败弹层）。
    func setIncludeAllNetworks(_ enabled: Bool) {
        var next = networkInclusion
        next.includeAllNetworks = enabled
        apply(next)
    }

    func setIncludeAPNs(_ enabled: Bool) {
        var next = networkInclusion
        next.includeAPNs = enabled
        apply(next)
    }

    private func apply(_ value: NetworkInclusion) {
        guard value != networkInclusion else { return }
        Task { try? await actions.setNetworkInclusion(value) }
    }


    /// 恒显合并输出 system 项（合并单一实现）；直连值随启动前探测
    /// 且连接期间不变——已连接显示值即启动配置值（探测落地经 Observation 追踪
    /// actions.directDns 自动刷新）。无激活 profile / MergeError → nil（占位）。
    var dnsInputRevision: Int { actions.mergeRevision }

    func refreshDnsServer() async {
        let revision = actions.mergeRevision
        guard !actions.activeConfigContent.isEmpty else {
            dnsServer = nil
            return
        }
        let input = actions.mergeInput()
        let resolved = await Task.detached(priority: .userInitiated) {
            Self.resolveDns(input)
        }.value
        guard !Task.isCancelled, revision == actions.mergeRevision else { return }
        dnsServer = resolved
    }

    /// 完整 UA 串写系统剪贴板 + 短暂「已复制」反馈（轻触感在 UI 层随 uaCopyCount 触发）。
    func copyUserAgent() {
        Clipboard.write(userAgent)
        uaCopyCount += 1
        uaCopied = true
        copyRevertTask?.cancel()
        copyRevertTask = Task { [weak self] in
            try? await Task.sleep(for: Self.copiedFeedbackDuration)
            guard !Task.isCancelled else { return }
            self?.uaCopied = false
        }
    }

    /// 外链地址；打开动作由视图经 `@Environment(\.openURL)` 执行——那是 View 层环境，
    /// 塞进 ViewModel 就得改用 UIApplication，让 ViewModel 依赖 UI 框架。
    var websiteURL: URL { actions.aboutLinks.website }
    var privacyURL: URL { actions.aboutLinks.privacy }

    /// 新版本检查（编排与记账都在 UpdateChecker，本页只呈现与发起「立即检查」）。
    var updates: UpdateChecker { actions.updates }

    /// 打开失败 → 「无法打开链接」提示，留在设置页。由视图回写结果。
    func linkOpenFailed() { linkErrorVisible = true }

    /// `v<app 版本>-<引擎版本>`。
    var versionLabel: String {
        "v\(infoString("CFBundleShortVersionString"))-\(engineVersion)"
    }

    var buildNumber: String { infoString("CFBundleVersion") }

    /// 关于页 Hero 的应用名：取 bundle 的显示名，不在代码里另写一个产品名字面量
    /// （`OneBoxM` 只出现在显示名 / bundle / 工程文件里）。
    var appDisplayName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? infoString("CFBundleName")
    }

    /// 关于页「系统信息」卡的引擎版本行（与版本页脚同一读取口）。
    var engineVersion: String { OneBoxMApp.engineVersion }

    /// 「本机用量」那一行的门：本机用量是某一份配置的账本，没有激活项就没有账本可看。
    var hasActiveProfile: Bool { actions.activeProfile != nil }

    /// 长按切换 build 号显示（仅会话内存态）。
    func toggleBuildNumber() { showBuildNumber.toggle() }

    // 版本页脚 800ms 滚动窗口内连点 3 次进开发者页。会话内存态，不持久化。
    private static let devUnlockTaps = 3
    private static let tapWindow: TimeInterval = 0.8
    @ObservationIgnored private var versionTaps = 0
    @ObservationIgnored private var lastTapAt: TimeInterval = 0

    /// 记一次点按；满 3 下即返回 true（调用方据此推入）。
    ///
    /// 窗口是**滚动**的：每次点按都重置计时，超窗即从 1 重新起算——不是「首次点按起 800ms 内点满」，
    /// 那种写法会让第 3 下卡在窗口边界上失败，而用户感觉自己点得很快。
    /// 用单调时钟而非墙钟：改系统时间不该影响一个手势。
    func tapVersion() -> Bool {
        let now = ProcessInfo.processInfo.systemUptime
        versionTaps = (now - lastTapAt <= Self.tapWindow) ? versionTaps + 1 : 1
        lastTapAt = now
        guard versionTaps >= Self.devUnlockTaps else { return false }
        versionTaps = 0
        return true
    }

    private func infoString(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            preconditionFailure("\(key) missing from Info.plist")
        }
        return value
    }

    private nonisolated static func resolveDns(_ input: MergeInput) -> String? {
        do {
            return MergedConfigMeta.parse(try ConfigMerge.merge(input)).systemDns
        } catch is MergeError {
            return nil
        } catch {
            preconditionFailure("mergedConfig threw non-MergeError: \(error)")
        }
    }
}
