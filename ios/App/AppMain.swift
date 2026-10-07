import SwiftUI
import os
import Core

// @main：依赖构造 + 注入。双 target：本 App 只装配 UI 进程用到的依赖；
// 隧道扩展进程侧的 EngineBinding 由 PacketTunnelProvider 自行构造（持 TunHost）。
// 换核只改绑定文件与 engine/ 管线，本装配与契约消费方零改动。
@main
struct OneBoxMApp: App {
    // MARK: - 启动参数常量
    //
    // 本组一律 `nonisolated`：它们本来就不是 MainActor 状态 —— 带着的隔离是 `App` 协议给本类型的，
    // 属于**声明位置的副作用**，不是这些值的性质。
    //
    // `nonisolated` 只在**初始化表达式本身不需要隔离**时成立（本组都是字符串字面量）。

    /// 目视验收专用启动参数：跳过后台刷新排期。见 `assembleActions` 里那段理由。
    nonisolated static let skipBackgroundRefreshArgument = "-skip-background-refresh"
    /// **Debug 构建里**把后台刷新排期**开回来**的显式参数。默认关、显式才开：忘了关的代价是用户机器上
    /// 每半小时被按真实配置地址抓一次配置并覆写存储，忘了开只是一次调试要重来。
    nonisolated static let enableBackgroundRefreshArgument = "-enable-background-refresh"
    /// 不排期后台刷新的成因。**不是可选的优化**：排期到点会按用户真实配置地址
    /// 联网抓取并覆写 `ProfileStore`，而 `interval` 是重复周期不是首跑延迟 —— 首次派发就在启动时。
    ///
    /// 测试宿主那一支**判「本进程是不是测试宿主」，不判启动参数**：App 层单测用 App 本体作测试宿主，
    /// 每跑一次 `make test` 就起一次真 app；参数要靠测试计划去传，而下一个测试计划不会记得传它。
    ///
    /// 不带参数起 app 的其余路径：模拟器由下面的 `#if targetEnvironment(simulator)`
    /// 在编译期盖住；真机装机由 `Makefile` 的 `run-ios` 补参数。
    ///
    /// **返回成因而不是布尔**：统一日志里那一行要说得出是哪个成因跳过的。
    private static var backgroundRefreshSkipReason: String? {
        let info = ProcessInfo.processInfo
        // 启动参数这一支放在最前：显式传了参数时，日志里那一行报的就是参数本身。
        if info.arguments.contains(skipBackgroundRefreshArgument) {
            return "launch argument"
        }
        // **模拟器一律不排期**，编译期判断：经模拟器起 app 的任何路径都不需要记得传任何东西，
        // 而**引擎没有模拟器切片** ⇒ 本仓 app 在模拟器里本就不是产品。
        // 不依赖 `BGTaskScheduler.submit` 在模拟器上恰好失败——那是平台行为，不是我们的保证。
        #if targetEnvironment(simulator)
        return "simulator build"
        #else
        // App 层单测**用 App 本体作测试宿主** ⇒ 每跑一次 `make test` 起一次真 app。
        if isTestHost {
            return "test host process"
        }
        // **Debug 构建默认不排期**：从 Xcode 直接 Run 的 Debug 构建上面两支都不覆盖，而 Debug 产物不出货。
        // 它不替代上面两支——本机跑 Release 配置仍只靠它们。
        #if DEBUG
        if !info.arguments.contains(enableBackgroundRefreshArgument) {
            return "debug build"
        }
        #endif
        return nil
        #endif
    }

    private static var isTestHost: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    static func refreshRecordStore() -> RefreshRecordStore {
        RefreshRecordStore(
            storage: FileRefreshRecordStorage(directory: AppGroupPaths.baseDirectory())
        )
    }
    @State private var bootstrap = AppBootstrap { await OneBoxMApp.assembleActions() }

    @MainActor
    private static func assembleActions() async -> AppActions {
        // ProfileStore / RuleStore 的整文件读取解码不能占用首帧 MainActor。
        let stores = await Task.detached(priority: .userInitiated) {
            LoadedAppStores.load()
        }.value

        // 三源日志唯一缓冲：controller（NATIVE）/ client（ENGINE）/ actions（APP）共喂一份。
        let logStore = LogStore()
        let networkInclusionStore = NetworkInclusionStore()
        // 同一 controller 也是 NE manager/session 的唯一所有者，观察绑定不再自行加载系统偏好。
        let controller = TunnelController(
            logStore: logStore,
            networkInclusion: { networkInclusionStore.get() }
        )
        // 观察通道的建立/失效/重建落 APP 源日志，使「ENGINE 段为什么不动了」在应用内可查。
        // 观察绑定的回调可能在任意线程，故在此 hop 到 MainActor 再喂唯一缓冲。
        let observationDiagnostic: @Sendable (LogLevel, String) -> Void = { level, message in
            Task { @MainActor in logStore.append(source: .app, level: level, message: message) }
        }
        // 挂起沿的闸门在这里就位：装配期在主线程读进程当前状态并订阅前后台，之后任意线程可读。
        let suspensionGate = ObservationSuspensionGate()
        let monitor = MonitorBinding(
            sessionAccess: controller,
            suspensionGate: suspensionGate,
            onDiagnostic: observationDiagnostic
        )
        let client = await TunnelClient.mount(monitor: monitor, logStore: logStore)
        let updates = UpdateChecker(
            storeLookup: AppStoreLookup(),
            recordStore: UpdateCheckRecordStore(),
            log: { level, message in logStore.append(source: .app, level: level, message: message) }
        )
        // UI 与开发期 harness 共用的动作层（消费方唯一入口，镜像 Android App.actions）。
        let actions = AppActions(
            controller: controller,
            client: client,
            monitor: monitor,
            profileStore: stores.profileStore,
            ruleStore: stores.ruleStore,
            networkInclusionStore: networkInclusionStore,
            logStore: logStore,
            aboutLinks: OneBoxMApp.aboutLinks(),
            updates: updates,
            debugFallbackConfig: OneBoxMApp.debugFallbackConfig(),
            acceleratorBase: OneBoxMApp.acceleratorBase(),
            refreshRecords: OneBoxMApp.refreshRecordStore(),
            onBackgroundRefreshChanged: { enabled in RefreshTask.sync(enabled: enabled) }
        )
        // 装配完即注入 runner 并按开关状态排期/撤销。两端调度器不同，runner 是同一个。
        RefreshTask.install { [weak actions] in await actions?.refreshAllProfiles() }
        if let reason = Self.backgroundRefreshSkipReason {
            // 目视验收专用：**唯一效果是不排期**，不改 UI、不写任何 store。`backgroundRefresh()` 默认为真，
            // 每一次启动都排上一个定时器，到点会按用户真实配置地址联网抓取并覆写配置存储。
            // 用启动参数而不是编译期开关：被看的二进制与出货的是同一个。
            // 只写统一日志、不写 `logStore`：日志页本身就在被看的屏里。
            os_log("%{public}@", log: .default, type: .default,
                   "acceptance: background refresh scheduling skipped by \(reason)")
        } else {
            RefreshTask.sync(enabled: actions.backgroundRefresh())
        }
        // 测试宿主每跑一次单测就起一次真 app，不能让它去抓生产清单、弹新版本提示。
        if !isTestHost {
            UpdateCheckTask.start(updates)
        }
        return actions
    }

    /// 加速代理 base URL：与外链同一条构建期注入通道，
    /// 但**可缺**——空串 = 未配置，回落判定恒不成立。故不像外链那样缺件即崩。
    private static func acceleratorBase() -> String {
        Bundle.main.object(forInfoDictionaryKey: "ACCELERATE_URL") as? String ?? ""
    }

    /// 引擎版本唯一读取口：构建期由 engine/Makefile 注入 Info.plist，App 进程读它不加载引擎。
    nonisolated static let engineVersion: String = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "ENGINE_VERSION") as? String, !raw.isEmpty else {
            preconditionFailure("missing ENGINE_VERSION in Info.plist — run `make links`")
        }
        return raw
    }()

    /// 引擎自陈：上游库只自陈版本，条目留空——不编造字段。
    nonisolated static var engineInfo: EngineInfo {
        EngineInfo.of(name: "default", version: engineVersion, entries: [])
    }

    var body: some Scene {
        WindowGroup {
            rootView
        }
        // 注册时机只有这里——BGTaskScheduler.register 要求在启动结束前调用，
        // 而本仓是纯 SwiftUI @main，这个场景修饰符正是为此提供的钩子。
        .backgroundTask(.appRefresh(RefreshTask.identifier)) {
            // 先排下一次：系统只投递已排期的那一次，不续排就只会跑一遍。
            await RefreshTask.schedule()
            // 后台恢复：排在刷新之前。设备若正被全局丢包，刷新本身必然失败，
            // 而这一步恰恰是要把网络还回去——顺序反了就永远等不到下一次机会。
            await TunnelController.disarmAllNetworksIfIdleInBackground()
            await RefreshTask.run()
            await UpdateCheckTask.run()
        }
    }

    private var rootView: some View {
        Group {
            if let actions = bootstrap.value {
                AppNav(actions: actions)
                    #if DEBUG
                    // 启动实参驱动的 harness（对位 Android 广播 harness）：装配完成即执行一次。
                    .task(id: ObjectIdentifier(actions)) { DebugLaunchHarness.run(actions: actions) }
                    #endif
            } else {
                AppLoadingView()
            }
        }
        .appTheme()
        .task { bootstrap.start() }
    }


    // 关于外链 URL：明文不入源码与文档（域名保密），构建期注入单通道——
    // `make links` 生成 Links.xcconfig（gitignored）→ Version.xcconfig 非可选 include →
    // Info.plist 变量替换落值 → 此处 Bundle 读取（debug/release 同路，键名与 Android BuildConfig
    // 字段同名）。注入缺失 = 装配缺件→ require 即崩，不产出缺链接的包。
    private static func aboutLinks() -> AboutLinks {
        AboutLinks(
            website: requiredLinkUrl("WEBSITE_URL"),
            privacy: requiredLinkUrl("PRIVACY_URL")
        )
    }

    private static func requiredLinkUrl(_ key: String) -> URL {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !raw.isEmpty, let url = URL(string: raw) else {
            preconditionFailure("missing \(key) in Info.plist — run `make links`")
        }
        return url
    }

    /// 无激活 profile 时的启动回退：debug 用最小直连引导配置于真机验收隧道生命周期；
    /// release 为空串（UI 空态门控保证启动不可达，见 AppActions.startTunnel）。
    private static func debugFallbackConfig() -> String {
        #if DEBUG
        return DebugConfig.minimalDirect
        #else
        return ""
        #endif
    }
}

private struct AppLoadingView: View {
    var body: some View {
        ProgressView()
            .controlSize(.large)
            .frame(width: 44, height: 44)
            .screenBackground()
    }
}

/// Core stores 是可变单所有者且未声明 Sendable。这里只做一次单向所有权移交：后台构造完成后，
/// 后台不再访问，两个实例此后只由 MainActor 上的 AppActions 持有。
private final class LoadedAppStores: @unchecked Sendable {
    let profileStore: ProfileStore
    let ruleStore: RuleStore

    private init(profileStore: ProfileStore, ruleStore: RuleStore) {
        self.profileStore = profileStore
        self.ruleStore = ruleStore
    }

    static func load() -> LoadedAppStores {
        let container = AppGroupPaths.baseDirectory()
        let profileStore = ProfileStore(storage: FileProfileStorage(directory: container))
        let ruleStore = RuleStore(storage: FileRuleStorage(directory: container))
        // 上一代数据在这里并入：动作层拿到的第一份快照就已经含着导入结果。
        LegacyDataImport.run(profiles: profileStore, rules: ruleStore)
        return LoadedAppStores(profileStore: profileStore, ruleStore: ruleStore)
    }
}

#if DEBUG
// 仅供 debug 构建的引导配置：最小直连（tun 入站 + direct 出站，无代理），
// 用于在没有 profile 时于真机验收隧道生命周期。
//
// 连**类型本身**一并条件编译，而不只是使用点：只包使用点时这段字面量是否进 release 二进制
// 要看优化器剥不剥，「release 不使用」就成了没有构造保证的口头承诺。
private enum DebugConfig {
    static let minimalDirect = """
    {
      "log": { "level": "info", "timestamp": true },
      "dns": {
        "servers": [
          { "tag": "local", "type": "udp", "server": "8.8.8.8", "server_port": 53 }
        ],
        "final": "local",
        "strategy": "prefer_ipv4"
      },
      "inbounds": [
        {
          "tag": "tun-in",
          "type": "tun",
          "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
          "mtu": 9000,
          "stack": "gvisor",
          "auto_route": true,
          "strict_route": false
        }
      ],
      "outbounds": [
        { "tag": "direct", "type": "direct" }
      ],
      "route": {
        "rules": [
          { "action": "sniff" },
          { "protocol": "dns", "action": "hijack-dns" }
        ],
        "final": "direct",
        "auto_detect_interface": true
      }
    }
    """
}
#endif
