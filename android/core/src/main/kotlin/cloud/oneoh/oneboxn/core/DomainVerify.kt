package cloud.oneoh.oneboxn.core

import java.security.MessageDigest

// 域名 sha256 白名单验证：对主机名的渐进后缀候选逐一求哈希，
// 任一命中受信集即放行；fail-closed——空主机名或空受信集恒不命中。
// 大小写归一是 UrlInfo.hostname 的责任；本类型不做归一，直接对入参求哈希。
// 与 iOS Core/DomainVerify.swift 逐字对应，golden/domain-verify.json 是行为裁判。

object DomainVerify {
    /** 编译期受信集：仅存 sha256 小写 hex；本仓任何处（含注释）不得出现其原像信息。 */
    val TRUSTED_SHA256: Set<String> = setOf(
        "183a5526e76751b07cd57236bc8f253d5424e02a3fc7da7c30f80919e975125a",
        "59fe86216c23236fb4c6ab50cd8d1e261b7cad754e3e7cab33058df5b32d12e1",
        "61e245b4e5c234b00865ab0f47ad1cc4a9b37dbc50159febea7e6dcaee8ce050",
    )

    /** UTF-8 → SHA-256 → 小写 hex。 */
    fun sha256Hex(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.encodeToByteArray())
        val sb = StringBuilder(digest.size * 2)
        for (byte in digest) {
            sb.append((byte.toInt() and 0xFF).toString(16).padStart(2, '0'))
        }
        return sb.toString()
    }

    /** 渐进后缀候选："a.b.c" → ["c","b.c","a.b.c"]（最短在前）；空串 → 空表。 */
    fun suffixCandidates(hostname: String): List<String> {
        if (hostname.isEmpty()) return emptyList()
        val labels = hostname.split('.')
        val candidates = mutableListOf<String>()
        for (i in labels.indices.reversed()) {
            candidates.add(labels.subList(i, labels.size).joinToString("."))
        }
        return candidates
    }

    /** 任一候选的 sha256Hex 命中 allowedSha256 即 true；空主机名或空集恒 false（fail-closed）。 */
    fun verify(hostname: String, allowedSha256: Set<String>): Boolean {
        if (allowedSha256.isEmpty()) return false
        return suffixCandidates(hostname).any { sha256Hex(it) in allowedSha256 }
    }
}
