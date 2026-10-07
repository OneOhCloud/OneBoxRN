package cloud.oneoh.oneboxn.net

// **仅 debug 源集**：唯一消费方是调试夹具 HarnessReceiver 的 test-google 指令。
// 放在 main 时，发布包会带着一段永远不会被调用、且会访问外部主机的网络代码——
// 既是死代码，也是不必要的上架面。

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

private const val GOOGLE_URL = "https://www.google.com"
private const val TIMEOUT_MS = 3_000L

// 连通性探针结果：达到即带 HTTP 状态码；未通则区分超时与其他网络错误。成功判据 = HTTP 200。
sealed interface GoogleResult {
    data class Http(val code: Int) : GoogleResult
    data object Timeout : GoogleResult
    data class Error(val message: String) : GoogleResult
}

// 测 Google 可达性：GET https://www.google.com，**整个请求 3s 硬上限**。
// 连接/读取各留 3s 作 backstop，但真正定论的是看门狗：到 3s 就强制 disconnect 解除阻塞——
// 否则被墙时连接能建立（放行 SYN-ACK）后卡在读取，且会跨多个 A 记录重试，拖到 ~6s。
// 未连 VPN 时直连被墙 → 3s 超时；连上后经隧道代理 → 200。
suspend fun testGoogleReachability(): GoogleResult = coroutineScope {
    val connection = (URL(GOOGLE_URL).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = TIMEOUT_MS.toInt()
        readTimeout = TIMEOUT_MS.toInt()
    }
    val timedOut = AtomicBoolean(false)
    val watchdog = launch(Dispatchers.IO) {
        delay(TIMEOUT_MS)
        timedOut.set(true)
        runCatching { connection.disconnect() }
    }
    try {
        withContext(Dispatchers.IO) { GoogleResult.Http(connection.responseCode) }
    } catch (timeout: SocketTimeoutException) {
        GoogleResult.Timeout
    } catch (error: IOException) {
        // 看门狗到点 disconnect 中断阻塞会走这里；用 timedOut 区分「3s 到点」与真实网络错误。
        if (timedOut.get()) GoogleResult.Timeout else GoogleResult.Error(error.message ?: error.javaClass.simpleName)
    } finally {
        watchdog.cancel()
        connection.disconnect()
    }
}
