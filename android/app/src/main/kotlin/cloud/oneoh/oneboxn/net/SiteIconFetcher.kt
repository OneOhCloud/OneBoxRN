package cloud.oneoh.oneboxn.net

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 站点图标（配置官网下的 favicon）的抓取（iOS 对等物 App/Net/SiteIconFetcher.swift）：GET，整体 10s 上限、
// 体积 256 KiB 上限，只有 2xx 且体积在限内才交回字节。图标地址只会是 https（core ProfileWebsite.iconUrl），
// 平台跟随重定向时不跨协议，取不到 http 上去。
// 图标只是点缀：超时、断网、非 2xx、超限都只是「这一次没取到」，一律交回 null 由调用方回落地球图标——
// 不上抛，也不进失败弹层。
class SiteIconFetcher {
    suspend fun fetch(address: String): ByteArray? = withContext(Dispatchers.IO) {
        // 地址是服务端下发的站点拼出来的：平台 URL 类不认它（MalformedURLException）同样只是没取到。
        val connection = try {
            URL(address).openConnection() as HttpURLConnection
        } catch (unreachable: IOException) {
            return@withContext null
        }
        connection.requestMethod = "GET"
        connection.connectTimeout = TIMEOUT_MS.toInt()
        connection.readTimeout = TIMEOUT_MS.toInt()
        // 整体时限的看门狗：连接与读超时按单次计时，挡不住慢滴流（理由同 HttpConfigFetcher）。
        val watchdog = launch {
            delay(TIMEOUT_MS)
            connection.disconnect()
        }
        try {
            read(connection)
        } catch (unreachable: IOException) {
            null
        } finally {
            watchdog.cancel()
            connection.disconnect()
        }
    }

    private fun read(connection: HttpURLConnection): ByteArray? {
        if (connection.responseCode !in 200..299) return null
        if (connection.contentLengthLong > MAXIMUM_BYTES) return null
        return connection.inputStream.use { readCappedBytes(it, MAXIMUM_BYTES) }?.takeIf { it.isNotEmpty() }
    }

    companion object {
        const val TIMEOUT_MS = 10_000L
        const val MAXIMUM_BYTES = 256 * 1024
    }
}

/** 边读边计：上限要在字节进内存之前生效，未知 Content-Length 与分块传输也绕不过去。超限 → null。 */
internal fun readCappedBytes(input: InputStream, maximumBytes: Int): ByteArray? {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(READ_BUFFER_BYTES)
    while (true) {
        val readBytes = input.read(buffer)
        if (readBytes < 0) return output.toByteArray()
        if (output.size() > maximumBytes - readBytes) return null
        output.write(buffer, 0, readBytes)
    }
}

private const val READ_BUFFER_BYTES = 16 * 1024
