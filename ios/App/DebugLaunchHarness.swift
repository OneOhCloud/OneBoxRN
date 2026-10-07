#if DEBUG
import Core
import Foundation
import os.log

// 仅 debug 构建：用启动实参驱动导入、切换、起停与可达性验证，对位 Android 的广播 harness。
// 结果打 `[[HARNESS]]` 行，取证方式与 Android 一致。
//
// 连**类型本身**一并条件编译（与 DebugConfig 同姿势）：
// 只包使用点时这段路径是否进 release 二进制要看优化器剥不剥。
//
// WHY 需要它：XCUITest 的 test runner 每次跑都是新装应用——要重新信任证书、要重新授权
// 逐 app 无线数据，任一环节都只能人工点。启动实参这条路由 `devicectl device process launch --arg`
// 直接驱动，全程无人工。
enum DebugLaunchHarness {
    private static let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "Harness")

    enum Argument {
        static let connect = "-harness-connect"
        static let disconnect = "-harness-disconnect"
        static let testGoogle = "-harness-test-google"
        static let testExcluded = "-harness-test-excluded"
        /// 后随订阅 URL；与 UI 同一条导入流水线，导入即激活、不碰隧道。
        static let importProfile = "-harness-import"
        /// 后随 profile id；与 UI 切换同一动作，隧道处置随之。
        static let activate = "-harness-activate"
        static let profiles = "-harness-profiles"
    }

    /// 可达性探针的端点与硬上限。与 Android harness 的 `test-google` 同口径。
    private static let endpoint = "https://www.google.com"
    private static let timeout: TimeInterval = 10

    @MainActor
    static func run(actions: AppActions, arguments: [String] = ProcessInfo.processInfo.arguments) {
        if arguments.contains(Argument.profiles) {
            logProfiles(actions: actions)
        }
        if let url = value(after: Argument.importProfile, in: arguments) {
            Task { await importProfile(actions: actions, url: url) }
        }
        if let id = value(after: Argument.activate, in: arguments) {
            Task { await activate(actions: actions, id: id) }
        }
        if arguments.contains(Argument.disconnect) {
            log("op=disconnect state=requested")
            Task { _ = await actions.disconnectAndWait(); log("op=disconnect state=done") }
        }
        if arguments.contains(Argument.connect) {
            log("op=connect state=requested")
            actions.connect()
        }
        // 跨进程开关必须每次显式落定：留着上一轮的标记会让下一轮在不知情中继续跑
        // 无 tun 模式，而两轮的日志长得一模一样。
        if arguments.contains(Argument.testExcluded) {
            Task { await testExcludedWhenConnected(actions: actions) }
        }
        if arguments.contains(Argument.testGoogle) {
            // 连接是异步的，探针要等隧道真起来再发——否则量到的是「还没连上」，不是「连上了不通」。
            Task { await testGoogleWhenConnected(actions: actions) }
        }
    }

    /// 等隧道连上再探；等不到就如实报等待超时，不发一个注定失败的请求充数。
    private static func testGoogleWhenConnected(actions: AppActions) async {
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            if await MainActor.run(body: { actions.connected }) { break }
            try? await Task.sleep(for: .milliseconds(500))
        }
        guard await MainActor.run(body: { actions.connected }) else {
            log("op=test-google result=not-connected")
            return
        }
        await testGoogle()
    }

    /// 写/清隧道扩展读的无 tun 模式标记。启动实参到不了扩展进程，故走 App Group 文件。
    /// 排除项判据：取一个**在排除段内**的地址。它必须取得到(证明连通),
    /// 而且引擎日志里不该出现对应的 `inbound=tun` 流(证明它根本没进隧道)。
    /// 两面都要：只看「取到了」会把「进了隧道再由引擎放行」当成排除生效。
    private static func testExcludedWhenConnected(actions: AppActions) async {
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            if await MainActor.run(body: { actions.connected }) { break }
            try? await Task.sleep(for: .milliseconds(500))
        }
        guard await MainActor.run(body: { actions.connected }) else {
            log("op=test-excluded result=not-connected")
            return
        }
        guard let url = URL(string: "https://\(excludedProbeHost)/") else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let started = Date()
        do {
            let (_, response) = try await URLSession(configuration: configuration).data(from: url)
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            log("op=test-excluded host=\(excludedProbeHost) status=\((response as? HTTPURLResponse)?.statusCode ?? -1) ms=\(ms)")
        } catch {
            let ns = error as NSError
            log("op=test-excluded host=\(excludedProbeHost) result=error domain=\(ns.domain) code=\(ns.code)")
        }
    }

    /// 排除段内的探测目标。选公共解析器而非内网地址：内网地址走不走隧道都能通,
    /// 区分不出排除项有没有生效。
    private static let excludedProbeHost = "223.5.5.5"

    private static func testGoogle() async {
        guard let url = URL(string: endpoint) else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let started = Date()
        do {
            let (data, response) = try await URLSession(configuration: configuration).data(from: url)
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            log("op=test-google status=\(status) bytes=\(data.count) ms=\(ms)")
        } catch {
            let ns = error as NSError
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            // 带域与码：本地化描述随系统语言变，码才可检索、可跨机器比对。
            log("op=test-google result=error domain=\(ns.domain) code=\(ns.code) ms=\(ms)")
        }
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    /// 只报 id 不报名称与 URL：名称可能回退成订阅 URL 的路径段，那是订阅凭据。
    @MainActor
    private static func logProfiles(actions: AppActions) {
        let ids = actions.profiles.map(\.id).joined(separator: ",")
        log("op=profiles count=\(actions.profiles.count) active=\(actions.activeProfile?.id ?? "none") ids=\(ids)")
    }

    @MainActor
    private static func importProfile(actions: AppActions, url: String) async {
        do {
            let phase = try await actions.importProfile(payload: ImportPayload(url: url, requestedApply: false))
            guard case .success = phase else {
                log("op=import result=error detail=\(phase.token)")
                return
            }
            // outbounds/bytes 只是落库后的观测，与 Android harness 同口径。
            let content = actions.activeConfigContent
            let root = try JSONSerialization.jsonObject(with: Data(content.utf8)) as? [String: Any]
            let outbounds = (root?["outbounds"] as? [Any])?.count ?? 0
            log("op=import profile=\(actions.activeProfile?.id ?? "none") outbounds=\(outbounds) bytes=\(content.utf8.count)")
        } catch {
            log("op=import result=error detail=\(describe(error))")
        }
    }

    @MainActor
    private static func activate(actions: AppActions, id: String) async {
        guard actions.profiles.contains(where: { $0.id == id }) else {
            log("op=activate result=error detail=unknown profile \(id)")
            return
        }
        do {
            try await actions.activate(id: id)
            log("op=activate profile=\(id) result=ok")
        } catch {
            log("op=activate profile=\(id) result=error detail=\(describe(error))")
        }
    }

    private static func log(_ message: String) {
        logger.notice("[[HARNESS]] \(message, privacy: .public)")
    }
}
#endif
