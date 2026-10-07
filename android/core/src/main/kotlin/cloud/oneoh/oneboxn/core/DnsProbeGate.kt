package cloud.oneoh.oneboxn.core

// 直连 DNS 探测的发包门。两端逐字对应。
//
// 放在 core 而不是各端动作层:这是「什么时候测得到直连」的判据,两端各写一份就会分叉,
// 而分叉只在真机上、只在热重载那一拍现形。

/**
 * 此刻发出的探测包是否真的走物理网卡。
 *
 * **判据比 `sessionPhase` 的 `NOT_RUNNING` 更严**:`STOPPING` 期间 TUN 还在,路由规则里
 * 那条 `hijack-dns`(排在 `ip_is_private → direct` 之前、且不看目的地址)照样把 App 进程的
 * UDP:53 就地截下来自己作答;叠加 `DnsProbe.isAcceptable` 只校验 Transaction ID 回显,被劫持的应答同样「可接受」,
 * 于是每一路都在毫秒级「成功」,胜者与「该 IP 直连是否可达」完全无关。
 *
 * 两端都没有豁免手段:Android 的 `protect()` 只存在于 `:tun` 进程的 VpnService 实例上,
 * App 进程跨进程拿不到;iOS 的 NE 只把**扩展进程**排除在隧道之外,容器 App 不在其列。
 * 故「测不到直连就不测」——沿用上一次隧道未建立时的胜者,陈旧但直连可达。
 */
fun directDnsProbeAllowed(osConnected: Boolean, engineStatus: EngineStatus): Boolean =
    !osConnected && engineStatus == EngineStatus.STOPPED
