package cloud.oneoh.oneboxn.core

// 配置服务在导入与刷新响应里经官网头下发的站点，以及它的站点图标地址。
// 头缺失或不是 http(s) 地址即没有站点：不回落到任何写死的站点。
// 手写判定而非平台 URL 类（理由同 UrlInfo）；空白与控制字符只认 ASCII 那一段，两端逐字一致。
// 与 iOS Core/ProfileWebsite.swift 逐字对应，golden/profile-website.json 是行为裁判。
object ProfileWebsite {
    /** 此头名属于配置服务的既有传输协议。 */
    const val HEADER = "official-website"

    private const val HTTP = "http://"
    private const val HTTPS = "https://"
    private const val ICON_PATH = "/favicon.ico"

    /** 头值去首尾空白后是 http(s) 地址、主机段非空、中间不夹空白即为站点，原样保留；否则 null。 */
    fun parse(header: String): String? {
        val value = header.trim(::isSpaceOrControl)
        val scheme = when {
            value.startsWith(HTTPS, ignoreCase = true) -> HTTPS
            value.startsWith(HTTP, ignoreCase = true) -> HTTP
            else -> return null
        }
        if (value.any(::isSpaceOrControl)) return null
        val rest = value.substring(scheme.length)
        val authorityEnd = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val authority = if (authorityEnd < 0) rest else rest.substring(0, authorityEnd)
        return if (authority.isEmpty()) null else value
    }

    /** 站点图标：只认 https；去掉查询与片段、再去尾斜杠，接 `/favicon.ico`。http 站点没有图标。 */
    fun iconUrl(website: String): String? {
        if (!website.startsWith(HTTPS, ignoreCase = true)) return null
        val suffixStart = website.indexOfFirst { it == '?' || it == '#' }
        val base = if (suffixStart < 0) website else website.substring(0, suffixStart)
        return base.trimEnd('/') + ICON_PATH
    }

    private fun isSpaceOrControl(char: Char): Boolean = char <= ' '
}
