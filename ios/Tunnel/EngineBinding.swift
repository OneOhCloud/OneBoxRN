import Foundation
import Network
import Core
@preconcurrency import EngineKit
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.tunnel", category: "EngineBinding")

// 隧道进程侧引擎绑定：实现 Engine 契约，内部驱动上游内核的命令服务器与平台接口。
// 本文件是命名门禁的豁免文件之一（Tunnel target 内唯一 import 上游库的地方）。
//
// 观察数据（流量/分组/日志）也从这里出：扩展进程内起一个命令客户端订阅自己的命令服务器，
// 转成中立类型推进 MonitorHub——用量记账与 datagram 观察通道都挂在枢纽上，App 挂起时照常运转，
// 而 App 进程从不加载引擎。
final class EngineBinding: Engine, @unchecked Sendable {
    private let platform: PlatformBridge
    private let observer: HubObserver
    private var commandServer: LibboxCommandServer?

    init(tunHost: TunHost, onServiceStop: @escaping () -> Void) {
        platform = PlatformBridge(tunHost: tunHost, onServiceStop: onServiceStop)
        observer = HubObserver(tunHost: tunHost)
    }

    func start(config: String) throws {
        // 分步阶段轨迹：扩展被杀/崩溃时走不到错误路径，靠它定位死在哪一步。
        StartStage.mark("engine-setup")
        try EngineBinding.ensureSetup()
        // fail-fast：先按内核 schema 校验配置，非法配置在建服务前即抛出。
        var checkError: NSError?
        guard LibboxCheckConfig(config, &checkError) else {
            throw checkError ?? EngineError(token: "CONFIG_INVALID")
        }
        StartStage.mark("engine-hub-reset")
        MonitorHub.shared.reset()
        MonitorHub.shared.installCommandSink(CommandBridge())
        StartStage.mark("engine-command-server")
        var serverError: NSError?
        guard let server = LibboxNewCommandServer(platform, platform, &serverError) else {
            throw serverError ?? EngineError(token: "COMMAND_SERVER_NIL")
        }
        try server.start()
        commandServer = server
        // startOrReloadService 会同步回调 platform.openTun 建立 TUN，失败即抛出。
        StartStage.mark("engine-service-start")
        try server.startOrReloadService(config, options: LibboxOverrideOptions())
        // 观察通道在内核起来之后才建：它只服务 UI 展示，任何故障都不该有机会拖累隧道启动。
        // 建不起来（路径超长/socket 失败）也只是 UI 无观察数据，隧道照跑。
        StartStage.mark("engine-observation-channel")
        MonitorHub.shared.installObservationSink(ObservationSender(baseDirectory: EnginePaths.base()))
        MonitorHub.shared.setRunning(.running)
        observer.connect()
    }

    /// 上游 `startOrReloadService` 本就是「有服务就换配置、没有就建」，命令服务器与
    /// 平台回调整个保留，故这里就是它——不重建 CommandServer，也不重新 `start()`。
    /// 观察客户端连的是命令服务器而不是服务实例，换配置不断流。
    func reload(config: String) throws {
        StartStage.mark("engine-reload")
        guard let server = commandServer else {
            throw EngineError(token: "RELOAD_NOT_RUNNING", detail: "command server is not running")
        }
        var checkError: NSError?
        guard LibboxCheckConfig(config, &checkError) else {
            throw checkError ?? EngineError(token: "CONFIG_INVALID")
        }
        try server.startOrReloadService(config, options: LibboxOverrideOptions())
    }

    func stop() {
        observer.disconnect()
        if let server = commandServer {
            commandServer = nil
            do {
                try server.closeService()
            } catch {
                server.setError("close service: \(describe(error))")
            }
            server.close()
        }
        platform.stopInterfaceMonitor()
        MonitorHub.shared.reset()
    }

    func pause() {
        commandServer?.pause()
    }

    func wake() {
        guard let server = commandServer else { return }
        server.wake()
        // 离开休眠后底层 socket 多半已死，强制重置使下一次请求重新拨号。
        server.resetNetwork()
    }

    // MARK: - Setup

    private static let setupLock = NSLock()
    nonisolated(unsafe) private static var setupDone = false

    /// 每进程一次的内核初始化（基路径决定命令 socket 位置；路径同源 EnginePaths）。
    private static func ensureSetup() throws {
        setupLock.lock()
        defer { setupLock.unlock() }
        if setupDone { return }
        let working = EnginePaths.working()
        let temp = EnginePaths.temp()
        for dir in [working, temp] {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let options = LibboxSetupOptions()
        options.basePath = EnginePaths.base().path
        options.workingPath = working.path
        options.tempPath = temp.path
        options.logMaxLines = 3000
        // 崩溃输出落 working/CrashReport-<source>.log，由 setup 自行重定向。
        options.crashReportSource = "NetworkExtension"
        // 扩展有系统强制的内存上限：内核按其默认上限控 GC 与连接回收，越线前自救而不是被系统杀掉。
        options.oomKillerEnabled = true
        var setupError: NSError?
        _ = LibboxSetup(options, &setupError)
        if let setupError { throw setupError }
        // 上一次若被内存上限击杀，把草稿转正为报告，下次排查有据可查。
        LibboxPromoteOOMDraft()
        setupDone = true
    }
}

// MARK: - 观察订阅

/// 扩展进程内的观察订阅。connect() 阻塞到连接结束，故跑在自己的线程上；代际号挡住
/// 断开之后仍在路上的回调，不让上一轮的帧写进下一轮会话。
private final class HubObserver: @unchecked Sendable {
    private let tunHost: TunHost
    private let lock = NSLock()
    private var client: LibboxCommandClient?
    private var generation: UInt64 = 0
    private var estimator = TrafficRateEstimator()

    init(tunHost: TunHost) {
        self.tunHost = tunHost
    }

    func connect() {
        let options = LibboxCommandClientOptions()
        options.statusInterval = Int64(NSEC_PER_SEC)
        options.addCommand(LibboxCommandStatus)
        options.addCommand(LibboxCommandGroup)
        options.addCommand(LibboxCommandLog)
        lock.lock()
        generation &+= 1
        let current = generation
        estimator = TrafficRateEstimator()
        let created = LibboxNewCommandClient(ObserverHandler(owner: self, generation: current), options)
        client = created
        lock.unlock()
        guard let created else {
            logger.error("observer client could not be created")
            return
        }
        DispatchQueue.global(qos: .utility).async {
            do {
                try created.connect()
            } catch {
                logger.error("observer connect failed: \(describe(error), privacy: .public)")
            }
        }
    }

    func disconnect() {
        lock.lock()
        generation &+= 1
        let current = client
        client = nil
        lock.unlock()
        try? current?.disconnect()
    }

    fileprivate func isCurrent(_ owner: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return owner == generation
    }

    fileprivate func pushStatus(_ message: LibboxStatusMessage, owner: UInt64) {
        lock.lock()
        guard owner == generation else {
            lock.unlock()
            return
        }
        let traffic = estimator.estimate(
            rawUp: message.uplink,
            rawDown: message.downlink,
            upTotal: message.uplinkTotal,
            downTotal: message.downlinkTotal,
            memory: message.memory,
            connIn: Int(message.connectionsIn),
            connOut: Int(message.connectionsOut),
            nowMillis: MonotonicClock.millis()
        )
        lock.unlock()
        MonitorHub.shared.pushTraffic(traffic)
    }

    fileprivate func pushLog(_ line: LogLine) {
        tunHost.writeLog(line)
        MonitorHub.shared.pushLog(line)
    }
}

// 命令客户端回调（在客户端后台读循环线程投递）。每个回调体包 autoreleasepool：投递线程是
// 引擎自建裸线程，无池时下游触 Foundation 产生的 autorelease 临时对象会随回调次数匀速驻留。
private final class ObserverHandler: NSObject, LibboxCommandClientHandlerProtocol, @unchecked Sendable {
    private weak var owner: HubObserver?
    private let generation: UInt64

    init(owner: HubObserver, generation: UInt64) {
        self.owner = owner
        self.generation = generation
        super.init()
    }

    func connected() {}

    func disconnected(_ message: String?) {
        guard let owner, owner.isCurrent(generation) else { return }
        logger.log("observer disconnected: \(message ?? "", privacy: .public)")
    }

    func writeStatus(_ message: LibboxStatusMessage?) {
        guard let message else { return }
        autoreleasepool { owner?.pushStatus(message, owner: generation) }
    }

    func writeGroups(_ message: (any LibboxOutboundGroupIteratorProtocol)?) {
        guard let message, let owner, owner.isCurrent(generation) else { return }
        autoreleasepool {
            var groups: [NodeGroup] = []
            while message.hasNext() {
                guard let group = message.next() else { continue }
                var nodes: [Node] = []
                let items = group.getItems()
                while items?.hasNext() == true {
                    guard let item = items?.next() else { continue }
                    nodes.append(Node(tag: item.tag, delayMs: Int(item.urlTestDelay)))
                }
                groups.append(NodeGroup(tag: group.tag, nodes: nodes, now: group.selected))
            }
            MonitorHub.shared.pushGroups(groups)
        }
    }

    func writeLogs(_ messageList: (any LibboxLogIteratorProtocol)?) {
        guard let messageList, let owner, owner.isCurrent(generation) else { return }
        autoreleasepool {
            while messageList.hasNext() {
                guard let entry = messageList.next() else { continue }
                owner.pushLog(LogLine(level: Self.levelOf(entry.level), message: entry.message))
            }
        }
    }

    func writeOutbounds(_ message: (any LibboxOutboundGroupItemIteratorProtocol)?) {}
    func clearLogs() {}
    func setDefaultLogLevel(_ level: Int32) {}
    func initializeClashMode(_ modeList: (any LibboxStringIteratorProtocol)?, currentMode: String?) {}
    func updateClashMode(_ newMode: String?) {}
    func write(_ events: LibboxConnectionEvents?) {}

    // 内核数值日志级别 → 中立 LogLevel（全射映射；未知数值收为最低级别是约定行为，非吞错）。
    private static func levelOf(_ level: Int32) -> LogLevel {
        switch level {
        case 0: return .panic
        case 1: return .fatal
        case 2: return .error
        case 3: return .warn
        case 4: return .info
        case 5: return .debug
        default: return .trace
        }
    }
}

// MARK: - 反向命令桥

// UI 的 selectNode/urlTest 经 handleAppMessage → 枢纽 → 此处落到内核命令通道。
// 失败只记日志不外抛（反向命令非数据面，不得拖垮隧道）。
private final class CommandBridge: HubCommandSink, @unchecked Sendable {
    func selectOutbound(groupTag: String, outboundTag: String) {
        do {
            try LibboxNewStandaloneCommandClient()?.selectOutbound(groupTag, outboundTag: outboundTag)
        } catch {
            logger.error("selectOutbound failed: \(describe(error), privacy: .public)")
        }
    }

    func urlTest(groupTag: String) {
        do {
            try LibboxNewStandaloneCommandClient()?.urlTest(groupTag)
        } catch {
            logger.error("urlTest failed: \(describe(error), privacy: .public)")
        }
    }
}

// MARK: - 平台接口

// 平台能力实现 + 命令服务器回调（一个对象同时满足两个引擎协议，参照上游扩展模式）。
private final class PlatformBridge: NSObject, LibboxPlatformInterfaceProtocol, LibboxCommandServerHandlerProtocol, @unchecked Sendable {
    private let tunHost: TunHost
    private let onServiceStop: () -> Void
    private var monitor: NWPathMonitor?
    private var listener: (any LibboxInterfaceUpdateListenerProtocol)?

    init(tunHost: TunHost, onServiceStop: @escaping () -> Void) {
        self.tunHost = tunHost
        self.onServiceStop = onServiceStop
        super.init()
    }

    // MARK: LibboxPlatformInterface

    func openTun(_ options: (any LibboxTunOptionsProtocol)?, ret0_: UnsafeMutablePointer<Int32>?) throws {
        guard let options, let ret0_ else { throw EngineError(token: "OPEN_TUN_NIL_ARGS") }
        let fd = try tunHost.openTun(toTunSpec(options))
        if fd >= 0 {
            ret0_.pointee = fd
            return
        }
        // TunHost 返回 -1：OS 隧道已建立但 packetFlow 私有键路径取不到 fd（新 iOS 已知失效点）。
        // 用引擎辅助函数扫描进程内 TUN 描述符回落。
        let recovered = LibboxGetTunnelFileDescriptor()
        guard recovered >= 0 else {
            throw EngineError(
                token: "TUN_FD_MISSING",
                detail: "packetFlow key path and engine descriptor scan both unavailable"
            )
        }
        logger.log("TUN fd recovered via engine descriptor scan: \(recovered)")
        ret0_.pointee = recovered
    }

    func autoDetectControl(_ fd: Int32) throws {
        _ = tunHost.protect(fd)
    }

    func usePlatformAutoDetectControl() -> Bool { false }

    func useProcFS() -> Bool { false }

    func findConnectionOwner(
        _ ipProtocol: Int32,
        sourceAddress: String?,
        sourcePort: Int32,
        destinationAddress: String?,
        destinationPort: Int32
    ) throws -> LibboxConnectionOwner {
        throw EngineError(token: "NOT_IMPLEMENTED", detail: "findConnectionOwner")
    }

    func getInterfaces() throws -> any LibboxNetworkInterfaceIteratorProtocol {
        guard let path = monitor?.currentPath, path.status != .unsatisfied else {
            return NetworkInterfaceList([])
        }
        var interfaces: [LibboxNetworkInterface] = []
        for available in path.availableInterfaces {
            let iface = LibboxNetworkInterface()
            iface.name = available.name
            iface.index = Int32(available.index)
            switch available.type {
            case .wifi: iface.type = LibboxInterfaceTypeWIFI
            case .cellular: iface.type = LibboxInterfaceTypeCellular
            case .wiredEthernet: iface.type = LibboxInterfaceTypeEthernet
            // 已知成员列全 + `@unknown default:`：`NWInterface.InterfaceType` 非 frozen。
            case .loopback, .other: iface.type = LibboxInterfaceTypeOther
            @unknown default: iface.type = LibboxInterfaceTypeOther
            }
            interfaces.append(iface)
        }
        return NetworkInterfaceList(interfaces)
    }

    func startDefaultInterfaceMonitor(_ listener: (any LibboxInterfaceUpdateListenerProtocol)?) throws {
        stopInterfaceMonitor()
        guard let listener else { return }
        self.listener = listener
        // 排除 `.other`（隧道类网卡，含本隧道自己的 utun）：默认接口一旦被上报成本隧道自己，
        // 内核出站就回环进它刚建的 tun。冷启动时表里还没有本隧道故恰好答对，热重载时必然答错。
        // 与 Android 的 NOT_VPN NetworkRequest 同一判据。
        let monitor = NWPathMonitor(prohibitedInterfaceTypes: [.other])
        self.monitor = monitor
        // 等到首个 path 结果再返回（上限 5s）：引擎启动流程紧接着要读默认接口，
        // 立即返回会让内核在空接口表上开始拨号。
        let ready = DispatchSemaphore(value: 0)
        let readyOnce = OnceFlag()
        monitor.pathUpdateHandler = { [weak self] path in
            self?.pushInterface(path)
            if path.status == .unsatisfied || !path.availableInterfaces.isEmpty, readyOnce.tryMark() {
                ready.signal()
            }
        }
        monitor.start(queue: DispatchQueue.global())
        _ = ready.wait(timeout: .now() + 5)
    }

    func closeDefaultInterfaceMonitor(_ listener: (any LibboxInterfaceUpdateListenerProtocol)?) throws {
        stopInterfaceMonitor()
    }

    func stopInterfaceMonitor() {
        monitor?.cancel()
        monitor = nil
        listener = nil
    }

    private func pushInterface(_ path: Network.NWPath) {
        guard let listener else { return }
        guard path.status != .unsatisfied, let iface = path.availableInterfaces.first else {
            listener.updateDefaultInterface("", interfaceIndex: -1, isExpensive: false, isConstrained: false)
            return
        }
        listener.updateDefaultInterface(
            iface.name,
            interfaceIndex: Int32(iface.index),
            isExpensive: path.isExpensive,
            isConstrained: path.isConstrained
        )
    }

    func underNetworkExtension() -> Bool { true }

    func includeAllNetworks() -> Bool { false }

    func clearDNSCache() {}

    func readWIFIState() -> LibboxWIFIState? { nil }

    func localDNSTransport() -> (any LibboxLocalDNSTransportProtocol)? { nil }

    func send(_ notification: LibboxNotification?) throws {}

    func cancelNotification(_ identifier: String?, typeID: Int32) throws {}

    // 以下为内核的可选平台能力（邻居表、平台 shell / SSH、桥接网卡）：本应用的配置不用到，
    // 声明「不使用平台实现」，被要求时即报错，不伪造结果。
    func startNeighborMonitor(_ listener: (any LibboxNeighborUpdateListenerProtocol)?) throws {}

    func closeNeighborMonitor(_ listener: (any LibboxNeighborUpdateListenerProtocol)?) throws {}

    func registerMyInterface(_ name: String?) {}

    func usePlatformShell() -> Bool { false }

    func checkPlatformShell() throws {
        throw EngineError(token: "NOT_SUPPORTED", detail: "platform shell")
    }

    func openShellSession(
        _ user: LibboxPlatformUser?,
        command: String?,
        environ: (any LibboxStringIteratorProtocol)?,
        term: String?,
        rows: Int32,
        cols: Int32
    ) throws -> any LibboxShellSessionProtocol {
        throw EngineError(token: "NOT_SUPPORTED", detail: "platform shell")
    }

    func readSystemSSHHostKey(_ error: NSErrorPointer) -> String {
        error?.pointee = EngineError(token: "NOT_SUPPORTED", detail: "ssh host key") as NSError
        return ""
    }

    func lookupSFTPServer(_ error: NSErrorPointer) -> String {
        error?.pointee = EngineError(token: "NOT_SUPPORTED", detail: "sftp") as NSError
        return ""
    }

    func lookupUser(_ username: String?) throws -> LibboxPlatformUser {
        throw EngineError(token: "NOT_SUPPORTED", detail: "platform user lookup")
    }

    func tailscaleHostname() -> String { "" }

    func usePlatformBridge() -> Bool { false }

    func createBridge(_ options: LibboxBridgeOptions?) throws -> any LibboxBridgeSessionProtocol {
        throw EngineError(token: "NOT_SUPPORTED", detail: "platform bridge")
    }

    // MARK: LibboxCommandServerHandler

    func serviceStop() throws { onServiceStop() }

    func serviceReload() throws {}

    func getSystemProxyStatus() throws -> LibboxSystemProxyStatus { LibboxSystemProxyStatus() }

    func setSystemProxyEnabled(_ enabled: Bool) throws {}

    func triggerNativeCrash() throws {
        throw EngineError(token: "NOT_SUPPORTED", detail: "native crash trigger")
    }

    func connectSSHAgent(_ ret0_: UnsafeMutablePointer<Int32>?) throws {
        throw EngineError(token: "NOT_SUPPORTED", detail: "ssh agent")
    }

    func writeDebugMessage(_ message: String?) {
        logger.debug("\(message ?? "", privacy: .public)")
    }

    // MARK: TunOptions → 中立 TunSpec

    private func toTunSpec(_ o: any LibboxTunOptionsProtocol) throws -> TunSpec {
        let autoRoute = o.getAutoRoute()
        let httpProxyEnabled = o.isHTTPProxyEnabled()
        // fail-fast：auto_route 下 DNS 地址取不到即抛真因，而非静默建一条无 DNS 的隧道。
        // 中立契约只承载一个 DNS 地址；内核给的是列表，取首个即其 TUN 网段内的劫持地址。
        let dns = autoRoute ? (strings(try o.getDNSServerAddress()).first ?? "") : ""
        return TunSpec(
            mtu: o.getMTU(),
            inet4Addresses: prefixes(o.getInet4Address()),
            inet6Addresses: prefixes(o.getInet6Address()),
            autoRoute: autoRoute,
            inet4Routes: prefixes(o.getInet4RouteAddress()),
            inet6Routes: prefixes(o.getInet6RouteAddress()),
            inet4RouteExcludes: prefixes(o.getInet4RouteExcludeAddress()),
            inet6RouteExcludes: prefixes(o.getInet6RouteExcludeAddress()),
            inet4RouteRanges: prefixes(o.getInet4RouteRange()),
            inet6RouteRanges: prefixes(o.getInet6RouteRange()),
            includePackages: strings(o.getIncludePackage()),
            excludePackages: strings(o.getExcludePackage()),
            dnsServer: dns,
            httpProxyEnabled: httpProxyEnabled,
            httpProxyServer: httpProxyEnabled ? o.getHTTPProxyServer() : "",
            httpProxyPort: httpProxyEnabled ? o.getHTTPProxyServerPort() : 0
        )
    }

    private func prefixes(_ iterator: (any LibboxRoutePrefixIteratorProtocol)?) -> [TunPrefix] {
        var out: [TunPrefix] = []
        guard let iterator else { return out }
        while iterator.hasNext() {
            guard let p = iterator.next() else { continue }
            out.append(TunPrefix(address: p.address(), prefix: p.prefix()))
        }
        return out
    }

    private func strings(_ iterator: (any LibboxStringIteratorProtocol)?) -> [String] {
        var out: [String] = []
        guard let iterator else { return out }
        while iterator.hasNext() { out.append(iterator.next()) }
        return out
    }
}

// 首个 path 结果只放行一次信号的标记（pathUpdateHandler 会反复回调）。
private final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var marked = false

    func tryMark() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if marked { return false }
        marked = true
        return true
    }
}

// 内核只顺序消费一次的网络接口迭代器最简实现。
private final class NetworkInterfaceList: NSObject, LibboxNetworkInterfaceIteratorProtocol {
    private var iterator: IndexingIterator<[LibboxNetworkInterface]>
    private var current: LibboxNetworkInterface?

    init(_ values: [LibboxNetworkInterface]) {
        iterator = values.makeIterator()
    }

    func hasNext() -> Bool {
        current = iterator.next()
        return current != nil
    }

    func next() -> LibboxNetworkInterface? { current }
}
