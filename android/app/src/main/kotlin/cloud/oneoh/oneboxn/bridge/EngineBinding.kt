package cloud.oneoh.oneboxn.bridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.system.OsConstants
import android.util.Log
import cloud.oneoh.oneboxn.core.Engine
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.LogLine
import cloud.oneoh.oneboxn.core.Node
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.TrafficRateEstimator
import cloud.oneoh.oneboxn.core.TunHost
import cloud.oneoh.oneboxn.core.TunPrefix
import cloud.oneoh.oneboxn.core.TunSpec
import cloud.oneoh.oneboxn.tunnel.MonitorHub
import cloud.oneoh.oneboxn.tunnel.MonitorRunningState
import cloud.oneoh.libbox.BridgeOptions
import cloud.oneoh.libbox.BridgeSession
import cloud.oneoh.libbox.CommandClient
import cloud.oneoh.libbox.CommandClientHandler
import cloud.oneoh.libbox.CommandClientOptions
import cloud.oneoh.libbox.CommandServer
import cloud.oneoh.libbox.CommandServerHandler
import cloud.oneoh.libbox.ConnectionEvents
import cloud.oneoh.libbox.ConnectionOwner
import cloud.oneoh.libbox.InterfaceUpdateListener
import cloud.oneoh.libbox.Libbox
import cloud.oneoh.libbox.LocalDNSTransport
import cloud.oneoh.libbox.LogIterator
import cloud.oneoh.libbox.NeighborUpdateListener
import cloud.oneoh.libbox.NetworkInterfaceIterator
import cloud.oneoh.libbox.Notification
import cloud.oneoh.libbox.OutboundGroupItemIterator
import cloud.oneoh.libbox.OutboundGroupIterator
import cloud.oneoh.libbox.OverrideOptions
import cloud.oneoh.libbox.PlatformInterface
import cloud.oneoh.libbox.PlatformUser
import cloud.oneoh.libbox.RoutePrefix
import cloud.oneoh.libbox.RoutePrefixIterator
import cloud.oneoh.libbox.SetupOptions
import cloud.oneoh.libbox.ShellSession
import cloud.oneoh.libbox.StatusMessage
import cloud.oneoh.libbox.StringIterator
import cloud.oneoh.libbox.SystemProxyStatus
import cloud.oneoh.libbox.TunOptions
import cloud.oneoh.libbox.WIFIState
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.InterfaceAddress
import java.util.concurrent.Executors
import java.net.NetworkInterface as JavaNetworkInterface
import cloud.oneoh.libbox.NetworkInterface as EngineNetworkInterface

// 隧道进程侧引擎绑定：实现 Engine 契约，内部驱动上游内核的命令服务器与平台接口。
// 本文件是命名门禁的豁免文件之一（:tun 进程内唯一 import 上游库的地方）。
//
// 观察数据（流量/分组/日志）也从这里出：本进程内起一个命令客户端订阅自己的命令服务器，
// 转成中立类型推进 MonitorHub——用量记账与通知渲染都挂在枢纽上，UI 进程挂起或被杀时照常运转，
// 而 UI 经 MonitorService 拿到的是同一份帧，UI 进程从不加载引擎原生库。
class EngineBinding(
    private val context: Context,
    private val tunHost: TunHost,
    // 内核内部请求停止（serviceStop）时回调，交由 TunnelService 执行标准拆除。
    private val onServiceStop: () -> Unit,
) : Engine {

    private val platform = PlatformBridge()
    private var commandServer: CommandServer? = null
    private val observer = HubObserver()

    override fun start(config: String) {
        ensureSetup(context)
        // fail-fast：先按内核 schema 校验配置，非法配置在建服务前即抛出。
        Libbox.checkConfig(config)
        MonitorHub.reset()
        MonitorHub.installCommandSink(HubCommandSink())
        val server = CommandServer(ServerHandler(), platform)
        server.start()
        commandServer = server
        // startOrReloadService 会同步回调 platform.openTun 建立 TUN，失败即抛出。
        server.startOrReloadService(config, OverrideOptions())
        MonitorHub.setRunning(MonitorRunningState.RUNNING)
        observer.connect()
    }

    /**
     * 热重载：上游 `startOrReloadService` 本就是「有服务就换配置、没有就建」，命令服务器与平台回调
     * 整个保留，故这里就是它——不重建 CommandServer，也不重新 `start()`。观察客户端连的是命令服务器
     * 而不是服务实例，换配置不断流。
     */
    override fun reload(config: String) {
        val server = checkNotNull(commandServer) { "android: command server is not running" }
        Libbox.checkConfig(config)
        server.startOrReloadService(config, OverrideOptions())
    }

    override fun stop() {
        observer.disconnect()
        val server = commandServer
        commandServer = null
        if (server != null) {
            runCatching { server.closeService() }.onFailure {
                runCatching { server.setError("android: close service: ${it.message}") }
            }
            runCatching { server.close() }
        }
        platform.stopInterfaceMonitor()
        MonitorHub.reset()
    }

    override fun pause() {
        commandServer?.pause()
    }

    override fun wake() {
        commandServer?.apply {
            wake()
            // 离开休眠后底层 socket 多半已死，强制重置使下一次请求重新拨号。
            resetNetwork()
        }
    }

    // 内核（命令服务器）侧回调。
    private inner class ServerHandler : CommandServerHandler {
        override fun serviceStop() {
            onServiceStop()
        }

        override fun serviceReload() = Unit

        override fun getSystemProxyStatus(): SystemProxyStatus = SystemProxyStatus()

        override fun setSystemProxyEnabled(isEnabled: Boolean) = Unit

        override fun triggerNativeCrash() = error("android: native crash trigger is not supported")

        override fun writeDebugMessage(message: String?) {
            Log.d(TAG, message ?: "")
        }

        override fun connectSSHAgent(): Int = error("android: ssh agent is not supported")
    }

    // UI 的 selectNode/urlTest 经 MonitorService（独立 executor 线程）→ 枢纽 → 此处。
    // 失败只记 WARN 不外抛（反向命令非数据面）。
    private inner class HubCommandSink : MonitorHub.CommandSink {
        override fun selectOutbound(groupTag: String, outboundTag: String) {
            runCatching { Libbox.newStandaloneCommandClient().selectOutbound(groupTag, outboundTag) }
                .onFailure { Log.w(TAG, "selectOutbound($groupTag, $outboundTag) failed: ${it.message}") }
        }

        override fun urlTest(groupTag: String) {
            runCatching { Libbox.newStandaloneCommandClient().urlTest(groupTag) }
                .onFailure { Log.w(TAG, "urlTest($groupTag) failed: ${it.message}") }
        }
    }

    /**
     * 本进程内的观察订阅。connect() 阻塞到连接结束，故跑在自己的线程上；代际号挡住
     * 断开之后仍在路上的回调，不让上一轮的帧写进下一轮会话。
     */
    private inner class HubObserver {
        private val loop = Executors.newSingleThreadExecutor { task -> Thread(task, "engine-observer") }
        private val estimator = TrafficRateEstimator()
        @Volatile private var client: CommandClient? = null
        @Volatile private var generation = 0L

        fun connect() {
            val current = ++generation
            val options = CommandClientOptions().apply {
                addCommand(Libbox.CommandStatus)
                addCommand(Libbox.CommandGroup)
                addCommand(Libbox.CommandLog)
                statusInterval = STATUS_INTERVAL_NANOS
            }
            val created = Libbox.newCommandClient(Handler(current), options)
            client = created
            loop.execute {
                runCatching { created.connect() }
                    .onFailure { Log.w(TAG, "observer connect failed: ${it.message}") }
            }
        }

        fun disconnect() {
            generation++
            client?.let { runCatching { it.disconnect() } }
            client = null
        }

        private inner class Handler(private val owner: Long) : CommandClientHandler {
            private fun current(): Boolean = owner == generation

            override fun connected() = Unit

            override fun disconnected(message: String?) {
                if (current()) Log.d(TAG, "observer disconnected: $message")
            }

            override fun writeStatus(message: StatusMessage) {
                if (!current()) return
                val traffic = synchronized(estimator) {
                    estimator.estimate(
                        rawUp = message.uplink,
                        rawDown = message.downlink,
                        upTotal = message.uplinkTotal,
                        downTotal = message.downlinkTotal,
                        memory = message.memory,
                        connIn = message.connectionsIn,
                        connOut = message.connectionsOut,
                        nowMillis = SystemClock.elapsedRealtime(),
                    )
                }
                MonitorHub.pushTraffic(traffic)
            }

            override fun writeGroups(message: OutboundGroupIterator?) {
                if (!current() || message == null) return
                val groups = mutableListOf<NodeGroup>()
                while (message.hasNext()) {
                    val group = message.next()
                    val nodes = mutableListOf<Node>()
                    val items = group.items
                    while (items.hasNext()) {
                        val item = items.next()
                        nodes.add(Node(item.tag, item.urlTestDelay))
                    }
                    groups.add(NodeGroup(group.tag, nodes, now = group.selected))
                }
                MonitorHub.pushGroups(groups)
            }

            override fun writeLogs(messageList: LogIterator?) {
                if (!current() || messageList == null) return
                while (messageList.hasNext()) {
                    val entry = messageList.next()
                    MonitorHub.pushLog(LogLine(levelOf(entry.level), entry.message))
                }
            }

            override fun writeOutbounds(message: OutboundGroupItemIterator?) = Unit
            override fun clearLogs() = Unit
            override fun setDefaultLogLevel(level: Int) = Unit
            override fun initializeClashMode(modeList: StringIterator?, currentMode: String?) = Unit
            override fun updateClashMode(newMode: String?) = Unit
            override fun writeConnectionEvents(events: ConnectionEvents?) = Unit
        }
    }

    // 平台能力实现，供内核回调：建立 TUN、保护出站 socket、枚举接口、监控默认网络。
    private inner class PlatformBridge : PlatformInterface {
        private val connectivity =
            context.getSystemService(ConnectivityManager::class.java)!!
        private val mainHandler = Handler(Looper.getMainLooper())
        private val monitorExecutor = Executors.newSingleThreadExecutor()
        private var networkCallback: ConnectivityManager.NetworkCallback? = null

        override fun openTun(options: TunOptions): Int {
            Log.d(TAG, "openTun: mtu=${options.mtu} autoRoute=${options.autoRoute}")
            return tunHost.openTun(options.toTunSpec())
        }

        override fun autoDetectInterfaceControl(fd: Int) {
            // 保护出站 socket，使其走底层物理网络而非回到 TUN（避免回环）。
            if (!tunHost.protect(fd)) error("android: protect fd=$fd failed")
        }

        override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

        override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

        override fun findConnectionOwner(
            ipProtocol: Int,
            sourceAddress: String,
            sourcePort: Int,
            destinationAddress: String,
            destinationPort: Int,
        ): ConnectionOwner {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) error("android: findConnectionOwner needs API 29+")
            val uid = connectivity.getConnectionOwnerUid(
                ipProtocol,
                InetSocketAddress(sourceAddress, sourcePort),
                InetSocketAddress(destinationAddress, destinationPort),
            )
            if (uid == Process.INVALID_UID) error("android: connection owner not found")
            val packages = context.packageManager.getPackagesForUid(uid)
            return ConnectionOwner().apply {
                userId = uid
                userName = packages?.firstOrNull() ?: ""
                setAndroidPackageNames(StringList(packages?.toList() ?: emptyList()))
            }
        }

        @Suppress("DEPRECATION") // getAllNetworks：无非弃用等价物，仍是枚举全部网络的正规方式
        override fun getInterfaces(): NetworkInterfaceIterator {
            val result = mutableListOf<EngineNetworkInterface>()
            val javaInterfaces = JavaNetworkInterface.getNetworkInterfaces().toList()
            for (network in connectivity.allNetworks) {
                val linkProperties = connectivity.getLinkProperties(network) ?: continue
                val capabilities = connectivity.getNetworkCapabilities(network) ?: continue
                // 跳过 VPN 网络（含本隧道自己的 tun0）：不过滤的话，本隧道会带着 IFF_UP 与它自己
                // 下发的 DNS 一起进内核接口表，内核据此选路就可能绕回自己。与下面 NetworkRequest
                // 隐含的 NOT_VPN 同一判据。
                if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) continue
                val name = linkProperties.interfaceName ?: continue
                val java = javaInterfaces.find { it.name == name } ?: continue
                val entry = EngineNetworkInterface()
                entry.name = name
                entry.index = java.index
                runCatching { entry.mtu = java.mtu }
                entry.dnsServer = StringList(linkProperties.dnsServers.mapNotNull { it.hostAddress })
                entry.addresses = StringList(java.interfaceAddresses.map { it.toPrefixString() })
                entry.type = when {
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
                    else -> Libbox.InterfaceTypeOther
                }
                var flags = 0
                if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    flags = OsConstants.IFF_UP or OsConstants.IFF_RUNNING
                }
                if (java.isLoopback) flags = flags or OsConstants.IFF_LOOPBACK
                if (java.isPointToPoint) flags = flags or OsConstants.IFF_POINTOPOINT
                if (java.supportsMulticast()) flags = flags or OsConstants.IFF_MULTICAST
                entry.flags = flags
                entry.metered = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                result.add(entry)
            }
            return InterfaceList(result)
        }

        override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
            stopInterfaceMonitor() // 幂等：重复注册前先撤销旧回调，避免泄漏
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = pushInterface(listener, network)
                override fun onLost(network: Network) = pushInterface(listener, null)
                override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) =
                    pushInterface(listener, network)
            }
            networkCallback = callback
            // 只跟踪底层「非 VPN」网络：NetworkRequest 默认隐含 NET_CAPABILITY_NOT_VPN，
            // 故隧道自身（tun0）永远不会被当作默认接口上报。用 registerDefaultNetworkCallback 则
            // 隧道建立后系统默认网络变为 tun0，出站会绕回 tun0，全部报 "no available network interface"。
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                connectivity.registerBestMatchingNetworkCallback(request, callback, mainHandler)
            } else {
                connectivity.requestNetwork(request, callback, mainHandler)
            }
            // 内核在本调用返回后同步初始化 route（含远程 rule-set 下载），届时必须已有默认接口，
            // 否则其出站 DNS 解析报 "no available network interface"，start 直接失败。
            // 故首个接口在本方法内同步上报（此回调来自内核 goroutine，非主线程，可安全阻塞重试）。
            //
            // **不能用 `activeNetwork`**：隧道一建立它就是本隧道的 VPN network，首报会把 tun0 当默认
            // 接口喂给内核。冷启动时恰好答对，热重载时必然答错。故首报走与 request 同一判据的枚举。
            reportInterface(listener, firstNonVpnInternetNetwork())
        }

        override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
            stopInterfaceMonitor()
        }

        fun stopInterfaceMonitor() {
            networkCallback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
            networkCallback = null
        }

        /** 与 startDefaultInterfaceMonitor 的 NetworkRequest 同判据：能上网、且不是 VPN。 */
        @Suppress("DEPRECATION") // getAllNetworks：无非弃用等价物，仍是枚举全部网络的正规方式
        private fun firstNonVpnInternetNetwork(): Network? = connectivity.allNetworks.firstOrNull { network ->
            connectivity.getNetworkCapabilities(network)?.let {
                it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            } == true
        }

        private fun pushInterface(listener: InterfaceUpdateListener, network: Network?) {
            // 后续变更（onAvailable/onLost/onLinkPropertiesChanged）走后台线程，避免在主线程回调里阻塞重试。
            monitorExecutor.execute { reportInterface(listener, network) }
        }

        // 接口 index 可能在网络刚 available 时尚未就绪，做短暂重试直到可读或放弃。
        private fun reportInterface(listener: InterfaceUpdateListener, network: Network?) {
            if (network == null) {
                runCatching { listener.updateDefaultInterface("", -1, false, false) }
                return
            }
            val name = connectivity.getLinkProperties(network)?.interfaceName ?: return
            repeat(10) {
                val index = runCatching { JavaNetworkInterface.getByName(name).index }.getOrNull()
                if (index != null) {
                    runCatching { listener.updateDefaultInterface(name, index, false, false) }
                    return
                }
                Thread.sleep(100)
            }
        }

        override fun underNetworkExtension(): Boolean = true

        override fun includeAllNetworks(): Boolean = false

        override fun clearDNSCache() = Unit

        override fun readWIFIState(): WIFIState? = null

        override fun localDNSTransport(): LocalDNSTransport? = null

        override fun sendNotification(notification: Notification) {
            Log.i(TAG, "engine notification: ${notification.title} — ${notification.body}")
        }

        override fun cancelNotification(identifier: String?, typeID: Int) = Unit

        // 以下为内核的可选平台能力（邻居表、平台 shell / SSH、桥接网卡）：本应用的配置不用到，
        // 声明「不使用平台实现」，被要求时即报错，不伪造结果。
        override fun startNeighborMonitor(listener: NeighborUpdateListener?) = Unit

        override fun closeNeighborMonitor(listener: NeighborUpdateListener?) = Unit

        override fun registerMyInterface(name: String?) = Unit

        override fun usePlatformShell(): Boolean = false

        override fun checkPlatformShell() = error("android: platform shell is not supported")

        override fun openShellSession(
            user: PlatformUser?,
            command: String?,
            environ: StringIterator?,
            term: String?,
            rows: Int,
            cols: Int,
        ): ShellSession = error("android: platform shell is not supported")

        override fun lookupUser(username: String?): PlatformUser = error("android: platform users are not supported")

        override fun lookupSFTPServer(): String = error("android: sftp is not supported")

        override fun readSystemSSHHostKey(): String = error("android: ssh host keys are not supported")

        override fun tailscaleHostname(): String = "${Build.MANUFACTURER} ${Build.MODEL}"

        override fun usePlatformBridge(): Boolean = false

        override fun createBridge(options: BridgeOptions?): BridgeSession = error("android: platform bridge is not supported")
    }

    // 把内核 TunOptions（一次性迭代器）翻译成中立 TunSpec。
    private fun TunOptions.toTunSpec(): TunSpec {
        val autoRoute = autoRoute
        val httpProxyEnabled = isHTTPProxyEnabled
        // 中立契约只承载一个 DNS 地址；内核给的是列表，取首个即其 TUN 网段内的劫持地址。
        val dns = if (autoRoute) dnsServerAddress.toStringList().firstOrNull().orEmpty() else ""
        return TunSpec(
            mtu = mtu,
            inet4Addresses = inet4Address.toPrefixList(),
            inet6Addresses = inet6Address.toPrefixList(),
            autoRoute = autoRoute,
            inet4Routes = inet4RouteAddress.toPrefixList(),
            inet6Routes = inet6RouteAddress.toPrefixList(),
            inet4RouteExcludes = inet4RouteExcludeAddress.toPrefixList(),
            inet6RouteExcludes = inet6RouteExcludeAddress.toPrefixList(),
            inet4RouteRanges = inet4RouteRange.toPrefixList(),
            inet6RouteRanges = inet6RouteRange.toPrefixList(),
            includePackages = includePackage.toStringList(),
            excludePackages = excludePackage.toStringList(),
            dnsServer = dns,
            httpProxyEnabled = httpProxyEnabled,
            httpProxyServer = if (httpProxyEnabled) httpProxyServer else "",
            httpProxyPort = if (httpProxyEnabled) httpProxyServerPort else 0,
        )
    }

    // —— 迭代器 → 列表 辅助 ——
    private fun RoutePrefixIterator.toPrefixList(): List<TunPrefix> {
        val list = mutableListOf<TunPrefix>()
        while (hasNext()) {
            val p: RoutePrefix = next()
            list.add(TunPrefix(p.address(), p.prefix()))
        }
        return list
    }

    private fun StringIterator.toStringList(): List<String> {
        val list = mutableListOf<String>()
        while (hasNext()) list.add(next())
        return list
    }

    private fun InterfaceAddress.toPrefixString(): String {
        val addr = address
        val host = if (addr is Inet6Address) {
            Inet6Address.getByAddress(addr.address).hostAddress
        } else {
            addr.hostAddress
        }
        return "$host/$networkPrefixLength"
    }

    // StringIterator 的最简实现（内核只顺序消费一次）。
    private class StringList(private val values: List<String>) : StringIterator {
        private val iterator = values.iterator()
        override fun len(): Int = values.size
        override fun hasNext(): Boolean = iterator.hasNext()
        override fun next(): String = iterator.next()
    }

    private class InterfaceList(values: List<EngineNetworkInterface>) : NetworkInterfaceIterator {
        private val iterator = values.iterator()
        override fun hasNext(): Boolean = iterator.hasNext()
        override fun next(): EngineNetworkInterface = iterator.next()
    }

    companion object {
        private const val TAG = "EngineBinding"
        private const val STATUS_INTERVAL_NANOS = 1_000_000_000L
        private const val CRASH_REPORT_SOURCE = "tunnel"

        @Volatile private var setupDone = false

        /** 每进程一次的内核初始化（基路径决定命令 socket 位置）。 */
        @Synchronized
        private fun ensureSetup(context: Context) {
            if (setupDone) return
            Libbox.setup(
                SetupOptions().apply {
                    basePath = EnginePaths.base(context).path
                    workingPath = EnginePaths.working(context).path
                    tempPath = EnginePaths.temp(context).path
                    logMaxLines = 3000
                    // 引擎崩溃输出落 working/CrashReport-<source>.log，由 setup 自行重定向。
                    crashReportSource = CRASH_REPORT_SOURCE
                },
            )
            setupDone = true
        }

        // 内核数值日志级别 → 中立 LogLevel（全射映射；未知数值收为最低级别是约定行为，非吞错）。
        private fun levelOf(level: Int): LogLevel = when (level) {
            0 -> LogLevel.PANIC
            1 -> LogLevel.FATAL
            2 -> LogLevel.ERROR
            3 -> LogLevel.WARN
            4 -> LogLevel.INFO
            5 -> LogLevel.DEBUG
            else -> LogLevel.TRACE
        }
    }
}
