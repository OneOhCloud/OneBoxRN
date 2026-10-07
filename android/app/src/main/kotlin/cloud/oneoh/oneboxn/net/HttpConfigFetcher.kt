package cloud.oneoh.oneboxn.net

import cloud.oneoh.oneboxn.ConfigResourceLimits
import cloud.oneoh.oneboxn.core.ConfigFetcher
import cloud.oneoh.oneboxn.core.FetchReply
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// core ConfigFetcher 端口的 HTTP 实现（iOS 对等物 App/Net/HttpConfigFetcher.swift）：
// 整体 30s wall-clock、连接建立 15s、重定向 ≤5 次手动跟随（平台默认跟随上限过宽且不跨主机策略不一）。
// 任何 HTTP 状态码连同头/体原样返回（判定归 core）；传输层失败抛平台异常，由 core 在边界类型化。
class HttpConfigFetcher : ConfigFetcher {

    override suspend fun fetch(url: String, userAgent: String): FetchReply = withContext(Dispatchers.IO) {
        val inflight = AtomicReference<HttpURLConnection?>(null)
        val wallClockExpired = AtomicBoolean(false)
        // wall-clock 看门狗：HttpURLConnection 的 read timeout 按单次读计时，挡不住慢滴流；
        // 到点强制断开在途连接，使阻塞读立即以 IOException 失败，再在下方转为超时语义。
        val watchdog = launch {
            delay(WALL_CLOCK_MS)
            wallClockExpired.set(true)
            inflight.get()?.disconnect()
        }
        try {
            followRedirects(URL(url), userAgent, inflight, wallClockExpired)
        } finally {
            watchdog.cancel()
        }
    }

    private fun followRedirects(
        origin: URL,
        userAgent: String,
        inflight: AtomicReference<HttpURLConnection?>,
        expired: AtomicBoolean,
    ): FetchReply {
        var current = origin
        var redirects = 0
        while (true) {
            if (expired.get()) throw wallClockTimeout()
            val connection = open(current, userAgent)
            inflight.set(connection)
            val reply = try {
                read(connection)
            } catch (failed: IOException) {
                if (expired.get()) throw wallClockTimeout()
                throw failed
            } finally {
                inflight.set(null)
                connection.disconnect()
            }
            val location = reply.header("Location")
            if (reply.status !in 300..399 || location.isEmpty() || redirects == MAX_REDIRECTS) {
                // 超限时把最后一跳 3xx 原样交回，由 core 判为非 2xx。
                return reply
            }
            current = URL(current, location) // 相对 Location 依当前跳解析
            redirects++
        }
    }

    private fun open(url: URL, userAgent: String): HttpURLConnection =
        (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            instanceFollowRedirects = false
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = WALL_CLOCK_MS.toInt() // 单次读兜底；整体上限由看门狗持有
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "application/json, */*")
        }

    // 读一跳完整响应；头名保持平台交付的大小写原样全量透传，同名多值合并（FetchReply 契约）。
    private fun read(connection: HttpURLConnection): FetchReply {
        val status = connection.responseCode
        val declaredBytes = connection.contentLengthLong
        if (declaredBytes > ConfigResourceLimits.MAX_IMPORTED_CONFIG_SIZE) throw responseTooLarge()
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val body = stream?.use { readUtf8Body(it, ConfigResourceLimits.MAX_IMPORTED_CONFIG_SIZE) } ?: ""
        val headers = LinkedHashMap<String, String>()
        for ((name, values) in connection.headerFields) {
            if (name == null) continue // 状态行的占位键
            headers[name] = values.joinToString(", ")
        }
        return FetchReply(status, body, headers)
    }

    private fun wallClockTimeout() =
        SocketTimeoutException("config fetch exceeded ${WALL_CLOCK_MS / 1000}s wall clock")

    private fun responseTooLarge() =
        IOException("config response exceeds ${ConfigResourceLimits.MAX_IMPORTED_CONFIG_SIZE / (1024 * 1024)} MiB")

    private companion object {
        const val WALL_CLOCK_MS = 30_000L
        const val CONNECT_TIMEOUT_MS = 15_000
        const val MAX_REDIRECTS = 5
    }
}

/** 逐块读取且在写入前检查上限，未知 Content-Length 与分块传输也不能绕过内存边界。 */
internal fun readUtf8Body(input: InputStream, maximumBytes: Int): String {
    require(maximumBytes > 0) { "maximumBytes must be positive" }
    val output = ByteArrayOutputStream(minOf(maximumBytes, READ_BUFFER_BYTES))
    val buffer = ByteArray(READ_BUFFER_BYTES)
    var totalBytes = 0
    while (true) {
        val readBytes = input.read(buffer)
        if (readBytes < 0) break
        if (totalBytes > maximumBytes - readBytes) {
            throw IOException("config response exceeds byte limit")
        }
        output.write(buffer, 0, readBytes)
        totalBytes += readBytes
    }
    return output.toByteArray().toString(Charsets.UTF_8)
}

private const val READ_BUFFER_BYTES = 16 * 1024
