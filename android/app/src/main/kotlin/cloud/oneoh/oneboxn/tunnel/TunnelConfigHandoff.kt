package cloud.oneoh.oneboxn.tunnel

import cloud.oneoh.oneboxn.ConfigResourceLimits
import java.io.File
import java.util.UUID

/** 跨进程启动配置通过私有文件交接，Intent 只携带固定长度令牌，避开 Binder 事务大小上限。 */
internal class TunnelConfigHandoff(
    private val directory: File,
    private val expirationAgeMillis: Long = DEFAULT_EXPIRATION_AGE_MILLIS,
    private val currentTimeMillis: () -> Long = System::currentTimeMillis,
) {
    fun store(config: String): String {
        check(directory.exists() || directory.mkdirs()) { "failed to create tunnel config handoff directory" }
        removeExpiredFiles()
        val bytes = config.toByteArray(Charsets.UTF_8)
        require(bytes.size <= ConfigResourceLimits.MAX_COMPILED_CONFIG_SIZE) {
            "compiled config exceeds handoff limit"
        }
        val token = "${UUID.randomUUID()}.json"
        val destination = file(token)
        try {
            destination.writeBytes(bytes)
        } catch (failed: Exception) {
            destination.delete()
            throw failed
        }
        return token
    }

    fun take(token: String): String {
        val source = file(token)
        return try {
            require(source.length() <= ConfigResourceLimits.MAX_COMPILED_CONFIG_SIZE) {
                "compiled config exceeds handoff limit"
            }
            source.readBytes().toString(Charsets.UTF_8)
        } finally {
            source.delete()
        }
    }

    fun discard(token: String) {
        file(token).delete()
    }

    private fun file(token: String): File {
        require(TOKEN.matches(token)) { "invalid tunnel config handoff token" }
        return directory.resolve(token)
    }

    private fun removeExpiredFiles() {
        val cutoff = currentTimeMillis() - expirationAgeMillis
        directory.listFiles()?.forEach { candidate ->
            if (TOKEN.matches(candidate.name) && candidate.lastModified() < cutoff) candidate.delete()
        }
    }

    private companion object {
        const val DEFAULT_EXPIRATION_AGE_MILLIS = 10 * 60 * 1000L
        val TOKEN = Regex("[0-9a-f-]{36}\\.json")
    }
}
