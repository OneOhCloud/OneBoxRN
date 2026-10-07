// 引擎契约（隧道进程侧）。全应用只依赖本契约，不依赖任何具体内核实现。
// 换核只重写 Tunnel/EngineBinding 与 engine/ 管线；本契约与其消费方零改动。
// 与 Android core/Engine.kt 逐字对应（值类型同名、字段同构）。

import Foundation

/// 由隧道进程驱动的引擎生命周期。失败即抛异常（fail-fast，不吞错）。
public protocol Engine: Sendable {
    func start(config: String) throws

    /// 热重载：按新配置就地重建引擎，**不动宿主的隧道**。
    ///
    /// 无缺省实现：换核时这是必须回答的问题，给一个「默认抛不支持」的兜底只会让新绑定
    /// 悄悄退化成不可重载，而调用方看不出区别。
    ///
    /// 实现须保证：隧道参数没变时不回调 `TunHost.openTun`（否则宿主会重建 OS 隧道，既有
    /// 连接全断，热重载就名存实亡）。失败即抛，由调用方收口。
    func reload(config: String) throws

    func stop()
    func pause()
    func wake()

    /// 空闲内存回收:宿主在 sleep/内存压力等非数据路径沿调用;幂等,缺省 no-op。
    func purgeIdleMemory()
}

extension Engine {
    public func purgeIdleMemory() {}
}

/// 隧道进程实现它，供 Engine 回调建立 OS 隧道、保护出站 socket 与写日志。
public protocol TunHost: AnyObject, Sendable {
    /// 建立 OS 隧道并返回 TUN 文件描述符。OS 隧道已建立但平台无公开途径取得 fd 时返回 -1，
    /// 由绑定层以引擎辅助手段回落获取（回落仍失败在绑定层携真因抛出）。
    func openTun(_ spec: TunSpec) throws -> Int32
    /// 把 fd 绑定到底层物理网络（绕开 TUN），避免出站 socket 回环。返回是否成功。
    func protect(_ fd: Int32) -> Bool
    func writeLog(_ line: LogLine)
}

/// 引擎内部阶段；UI 连接真相另有权威（OS VPN 状态）。
public enum EngineStatus: Sendable {
    case stopped
    case starting
    case started
    case stopping
}

/// 中立错误。token 属契约中立词表（如 START_FAILED_GENERIC），
/// detail 承载 stderr 尾部 / 启动快照；两端绑定各自映射上游错误。
/// LocalizedError：错误跨 NSError 边界（引擎回调抛错经 gomobile 桥接）时以
/// token+detail 透传真因；否则只剩「Core.EngineError 错误 1」占位文本，诊断被吞。
public struct EngineError: Error, Sendable, Equatable, LocalizedError {
    public let token: String
    public let detail: String?

    public init(token: String, detail: String? = nil) {
        self.token = token
        self.detail = detail
    }

    public var errorDescription: String? {
        guard let detail, !detail.isEmpty else { return token }
        return "\(token): \(detail)"
    }
}

/// 地址/前缀对（中立形式，替代内核特有的 route-prefix 类型）。
public struct TunPrefix: Sendable, Equatable {
    public let address: String
    public let prefix: Int32

    public init(address: String, prefix: Int32) {
        self.address = address
        self.prefix = prefix
    }
}

/// OS 隧道参数（中立完整描述，足以驱动平台 TUN builder）。
/// 绑定层把内核的 tun 选项翻译成本类型交给 TunHost；TunHost 据此建立 OS 隧道。
/// autoRoute 为 false 时仅配置地址；route/routeRange 二选一由平台 API 版本决定。
public struct TunSpec: Sendable {
    public let mtu: Int32
    public let inet4Addresses: [TunPrefix]
    public let inet6Addresses: [TunPrefix]
    public let autoRoute: Bool
    public let inet4Routes: [TunPrefix]
    public let inet6Routes: [TunPrefix]
    public let inet4RouteExcludes: [TunPrefix]
    public let inet6RouteExcludes: [TunPrefix]
    public let inet4RouteRanges: [TunPrefix]
    public let inet6RouteRanges: [TunPrefix]
    public let includePackages: [String]
    public let excludePackages: [String]
    public let dnsServer: String
    public let httpProxyEnabled: Bool
    public let httpProxyServer: String
    public let httpProxyPort: Int32

    public init(
        mtu: Int32,
        inet4Addresses: [TunPrefix],
        inet6Addresses: [TunPrefix],
        autoRoute: Bool,
        inet4Routes: [TunPrefix],
        inet6Routes: [TunPrefix],
        inet4RouteExcludes: [TunPrefix],
        inet6RouteExcludes: [TunPrefix],
        inet4RouteRanges: [TunPrefix],
        inet6RouteRanges: [TunPrefix],
        includePackages: [String],
        excludePackages: [String],
        dnsServer: String,
        httpProxyEnabled: Bool,
        httpProxyServer: String,
        httpProxyPort: Int32
    ) {
        self.mtu = mtu
        self.inet4Addresses = inet4Addresses
        self.inet6Addresses = inet6Addresses
        self.autoRoute = autoRoute
        self.inet4Routes = inet4Routes
        self.inet6Routes = inet6Routes
        self.inet4RouteExcludes = inet4RouteExcludes
        self.inet6RouteExcludes = inet6RouteExcludes
        self.inet4RouteRanges = inet4RouteRanges
        self.inet6RouteRanges = inet6RouteRanges
        self.includePackages = includePackages
        self.excludePackages = excludePackages
        self.dnsServer = dnsServer
        self.httpProxyEnabled = httpProxyEnabled
        self.httpProxyServer = httpProxyServer
        self.httpProxyPort = httpProxyPort
    }
}

/// 仅通用概念，无内核特有字段（不含 goroutines 等 Go 运行时特有量）。
public struct Traffic: Sendable, Equatable {
    public let up: Int64
    public let down: Int64
    public let upTotal: Int64
    public let downTotal: Int64
    public let memory: Int64
    /// 会话峰值内存：生产侧尽力字段，0 = 生产侧不可用（消费侧降级趋势窗口峰值）。
    public let memoryPeak: Int64
    public let connIn: Int
    public let connOut: Int

    public init(
        up: Int64,
        down: Int64,
        upTotal: Int64,
        downTotal: Int64,
        memory: Int64,
        memoryPeak: Int64 = 0,
        connIn: Int,
        connOut: Int
    ) {
        self.up = up
        self.down = down
        self.upTotal = upTotal
        self.downTotal = downTotal
        self.memory = memory
        self.memoryPeak = memoryPeak
        self.connIn = connIn
        self.connOut = connOut
    }
}

public struct Node: Sendable, Equatable {
    public let tag: String
    public let delayMs: Int

    public init(tag: String, delayMs: Int) {
        self.tag = tag
        self.delayMs = delayMs
    }
}

public struct NodeGroup: Sendable, Equatable {
    public let tag: String
    public let nodes: [Node]
    public let now: String

    public init(tag: String, nodes: [Node], now: String) {
        self.tag = tag
        self.nodes = nodes
        self.now = now
    }
}

/// 日志级别：七级全序，rawValue 序即比较序（trace 最低）；全仓不以字符串承载级别。
public enum LogLevel: Int, Comparable, CaseIterable, Sendable {
    case trace, debug, info, warn, error, fatal, panic

    /// 小写 token（日志文本呈现用）。
    public var token: String { String(describing: self) }

    /// `token` 的逆。写侧（隧道进程落盘）与读侧（App 回读）共用同一张表——两边各写一份
    /// 迟早分叉，而分叉只在「启动失败、正要看日志」那一拍现形。
    public static func fromToken(_ token: String) -> LogLevel? {
        allCases.first { $0.token == token }
    }

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool { lhs.rawValue < rhs.rawValue }
}

public struct LogLine: Sendable, Equatable {
    public let level: LogLevel
    public let message: String

    public init(level: LogLevel, message: String) {
        self.level = level
        self.message = message
    }
}
