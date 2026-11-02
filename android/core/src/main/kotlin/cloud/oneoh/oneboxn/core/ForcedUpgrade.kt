package cloud.oneoh.oneboxn.core

// 强制升级判定：已导入的配置全部来自指定来源时，本客户端不再服务，须换用新版。
// 来源只以 sha256 参与判定（域名保密），后缀匹配规则沿用 DomainVerify。
// 与 iOS Core/ForcedUpgrade.swift 逐字对应，golden/forced-upgrade.json 是行为裁判。

object ForcedUpgrade {
    /** 来源集：仅存 sha256 小写 hex，且必须是 DomainVerify.TRUSTED_SHA256 的子集；本仓任何处不得出现其原像信息。 */
    val SOURCE_SHA256: Set<String> = setOf(
        "61e245b4e5c234b00865ab0f47ad1cc4a9b37dbc50159febea7e6dcaee8ce050",
    )

    /** 至少一份配置，且每份配置地址的主机名都命中来源集。 */
    fun isRequired(profileUrls: List<String>, sourceSha256: Set<String> = SOURCE_SHA256): Boolean =
        profileUrls.isNotEmpty() &&
            profileUrls.all { DomainVerify.verify(UrlInfo.hostname(it), sourceSha256) }
}
