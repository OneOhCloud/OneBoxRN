package cloud.oneoh.oneboxn.net

import cloud.oneoh.oneboxn.core.DnsProbe
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.flatMapMerge
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withTimeoutOrNull

/**
 * DNS 竞速执行器（镜像 iOS App/Net/DnsRace.swift）：全部候选并发 UDP 探测，
 * 首个可接受响应者胜出；入口总限时 500ms，零响应返回 null（回落到取值链的下一级）。
 * 纯件（候选表/构包/判定）唯一出处 = core DnsProbe。
 */
@OptIn(ExperimentalCoroutinesApi::class)
suspend fun raceDnsProbe(): String? = withTimeoutOrNull(DnsProbe.TIMEOUT_MS) {
    DnsProbe.SERVERS.asFlow()
        .flatMapMerge(concurrency = DnsProbe.SERVERS.size) { server ->
            flow { if (probe(server)) emit(server) }
        }
        .flowOn(Dispatchers.IO)
        .firstOrNull()
}

// 单路探测：阻塞收发跑 IO 调度器；首响应后其余路的阻塞 receive 取消不掉，
// 依赖 soTimeout 到点释放线程（≤500ms），勿删超时「优化」。IO 失败等同该路无响应
//（约定结局，非吞错）。
private fun probe(server: String): Boolean = try {
    DatagramSocket().use { socket ->
        socket.soTimeout = DnsProbe.TIMEOUT_MS.toInt()
        val query = DnsProbe.queryBytes()
        socket.send(DatagramPacket(query, query.size, InetAddress.getByName(server), DnsProbe.PORT))
        val buffer = ByteArray(512)
        val packet = DatagramPacket(buffer, buffer.size)
        socket.receive(packet)
        DnsProbe.isAcceptable(buffer.copyOf(packet.length))
    }
} catch (unreachable: IOException) {
    false
}
