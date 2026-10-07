package cloud.oneoh.oneboxn.core

// 引擎契约（隧道进程侧）。全应用只依赖本契约，不依赖任何具体内核实现。
// 换核只重写 bridge 绑定文件与 engine/ 管线；本契约与其消费方零改动。

/** 由隧道进程驱动的引擎生命周期。失败即抛异常（fail-fast，不吞错）。 */
interface Engine {
    fun start(config: String)

    /**
     * 热重载：按新配置就地重建引擎，**不动宿主的隧道**。
     *
     * 无缺省实现：换核时这是必须回答的问题，给一个「默认抛不支持」的兜底只会让新绑定
     * 悄悄退化成不可重载，而调用方看不出区别。
     *
     * 实现须保证：隧道参数没变时不回调 `TunHost.openTun`（否则宿主会重建 OS 隧道，既有
     * 连接全断，热重载就名存实亡）。失败即抛，由调用方收口。
     */
    fun reload(config: String)

    fun stop()
    fun pause()
    fun wake()

    /** 空闲内存回收:宿主在内存修剪等非数据路径沿调用;幂等,缺省 no-op。 */
    fun purgeIdleMemory() {}
}

/** 隧道进程实现它，供 Engine 回调建立 OS 隧道、保护出站 socket 与写日志。 */
interface TunHost {
    fun openTun(spec: TunSpec): Int
    /** 把 fd 绑定到底层物理网络（绕开 TUN），避免出站 socket 回环。返回是否成功。 */
    fun protect(fd: Int): Boolean
    fun writeLog(line: LogLine)
}

/** 引擎内部阶段；UI 连接真相另有权威（OS VPN 状态）。 */
enum class EngineStatus { STOPPED, STARTING, STARTED, STOPPING }

/**
 * 中立错误。token 属契约中立词表（如 START_FAILED_GENERIC），
 * detail 承载 stderr 尾部 / 启动快照；两端绑定各自映射上游错误。
 */
data class EngineError(val token: String, val detail: String? = null)

/** 地址/前缀对（中立形式，替代内核特有的 route-prefix 类型）。 */
data class TunPrefix(val address: String, val prefix: Int)

/**
 * OS 隧道参数（中立完整描述，足以驱动平台 TUN builder）。
 * 绑定层把内核的 tun 选项翻译成本类型交给 TunHost；TunHost 据此建立 OS 隧道。
 * autoRoute 为 false 时仅配置地址；route/routeRange 二选一由平台 API 版本决定
 * （新版用 route + routeExclude 精确前缀，旧版用已合并的 routeRange）。
 */
data class TunSpec(
    val mtu: Int,
    val inet4Addresses: List<TunPrefix>,
    val inet6Addresses: List<TunPrefix>,
    val autoRoute: Boolean,
    val inet4Routes: List<TunPrefix>,
    val inet6Routes: List<TunPrefix>,
    val inet4RouteExcludes: List<TunPrefix>,
    val inet6RouteExcludes: List<TunPrefix>,
    val inet4RouteRanges: List<TunPrefix>,
    val inet6RouteRanges: List<TunPrefix>,
    val includePackages: List<String>,
    val excludePackages: List<String>,
    val dnsServer: String,
    val httpProxyEnabled: Boolean,
    val httpProxyServer: String,
    val httpProxyPort: Int,
)

/** 仅通用概念，无内核特有字段（不含 goroutines 等 Go 运行时特有量）。 */
data class Traffic(
    val up: Long,
    val down: Long,
    val upTotal: Long,
    val downTotal: Long,
    val memory: Long,
    /** 会话峰值内存：生产侧尽力字段，0 = 生产侧不可用（消费侧降级趋势窗口峰值）。 */
    val memoryPeak: Long = 0,
    val connIn: Int,
    val connOut: Int,
)

data class Node(val tag: String, val delayMs: Int)

data class NodeGroup(
    val tag: String,
    val nodes: List<Node>,
    val now: String,
)

/** 日志级别:七级全序,声明序即比较序(trace 最低);全仓不以字符串承载级别。 */
enum class LogLevel {
    TRACE, DEBUG, INFO, WARN, ERROR, FATAL, PANIC;

    /** 小写 token(日志文本呈现用)。 */
    val token: String get() = name.lowercase()
}

data class LogLine(val level: LogLevel, val message: String)
