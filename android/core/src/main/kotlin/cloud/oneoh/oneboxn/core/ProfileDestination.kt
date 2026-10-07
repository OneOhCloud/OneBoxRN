package cloud.oneoh.oneboxn.core

// 配置详情头部：点开去哪（去向），砖上画什么（图标）。与 Apple Core/ProfileDestination.swift 同口径，
// golden/profile-destination.json 是两端行为裁判。
// 「打得开」手写判定而非平台 URL 类（理由同 UrlInfo）：只认 http(s)、主机非空、端口段全是数字。

/** 配置详情头部点开以后去哪：服务端下发了站点就去配置站点，否则去产品官网。 */
sealed interface ProfileDestination {
    val url: String

    /** [iconAddress] 为 null：这个站点不取站标（只认 https，见 [ProfileWebsite.iconUrl]）。 */
    data class ProfileSite(override val url: String, val iconAddress: String?) : ProfileDestination

    data class ProductWebsite(override val url: String) : ProfileDestination

    /** 胶囊上的字：完整地址在点开之后的浏览器里，头部只写主机。 */
    val hostname: String get() = UrlInfo.hostname(url)

    /**
     * 砖上画什么：图标说的就是点开去哪。[known] 按图标地址给出站标缓存里已有的结局。
     *
     * 不收超额：超额是用量的属性，信号落在用量上；头部是入口，换成警示号就看不出点开去哪。
     */
    fun <I> mark(known: (String) -> SiteIconEntry<I>?): ProfileMark<I> = when (this) {
        is ProductWebsite -> ProfileMark.BrandMark
        is ProfileSite -> when (val entry = iconAddress?.let(known)) {
            is SiteIconEntry.Icon -> ProfileMark.SiteIcon(entry.image)
            SiteIconEntry.Unavailable, null -> ProfileMark.Globe
        }
    }

    companion object {
        /**
         * 站点打不开（不是 http(s)、主机为空、端口不是数字）时也去产品官网：头部总得有一个打得开的去向。
         * 产品官网是构建期注入的常量，它自己打不开即崩（装配缺件，fail-fast）。
         */
        fun of(website: String?, productWebsite: String): ProfileDestination {
            require(opensAsWebAddress(productWebsite)) { "product website is not a web address" }
            if (website == null || !opensAsWebAddress(website)) return ProductWebsite(productWebsite)
            return ProfileSite(website, ProfileWebsite.iconUrl(website))
        }

        private fun opensAsWebAddress(address: String): Boolean {
            val scheme = WEB_SCHEMES.firstOrNull { address.startsWith(it, ignoreCase = true) } ?: return false
            if (UrlInfo.hostname(address).isEmpty()) return false
            val rest = address.substring(scheme.length)
            val authorityEnd = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
            val host = (if (authorityEnd < 0) rest else rest.substring(0, authorityEnd)).substringAfterLast('@')
            // IPv6 字面量里的冒号不是端口分隔：括号闭合与否 UrlInfo.hostname 已判过。
            val port = if (host.startsWith("[")) host.substringAfter(']').removePrefix(":") else host.substringAfter(':', "")
            return port.all { it in '0'..'9' }
        }

        private val WEB_SCHEMES = listOf("https://", "http://")
    }
}

/** 站标缓存对一个图标地址已知的结局。[I] 是平台的图像类型：core 不碰图像解码。 */
sealed interface SiteIconEntry<out I> {
    data class Icon<out I>(val image: I) : SiteIconEntry<I>

    data object Unavailable : SiteIconEntry<Nothing>
}

/** 站标砖的内容：站标，或按去向回落的两枚字形之一。 */
sealed interface ProfileMark<out I> {
    data class SiteIcon<out I>(val image: I) : ProfileMark<I>

    /** 配置站点的站标还在取、取不到，或站点是 http 不取。 */
    data object Globe : ProfileMark<Nothing>

    /** 去向是产品官网。 */
    data object BrandMark : ProfileMark<Nothing>
}
