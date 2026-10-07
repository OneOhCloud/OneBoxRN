import CryptoKit
import Foundation

// 域名 sha256 白名单验证：对主机名的渐进后缀候选逐一求哈希，
// 任一命中受信集即放行；fail-closed——空主机名或空受信集恒不命中。
// 大小写归一是 UrlInfo.hostname 的责任；本类型不做归一，直接对入参求哈希。
// 与 Android core/DomainVerify.kt 逐字对应，golden/domain-verify.json 是行为裁判。

public enum DomainVerify {
    /// 编译期受信集：仅存 sha256 小写 hex；本仓任何处（含注释）不得出现其原像信息。
    public static let TRUSTED_SHA256: Set<String> = [
        "183a5526e76751b07cd57236bc8f253d5424e02a3fc7da7c30f80919e975125a",
        "59fe86216c23236fb4c6ab50cd8d1e261b7cad754e3e7cab33058df5b32d12e1",
        "61e245b4e5c234b00865ab0f47ad1cc4a9b37dbc50159febea7e6dcaee8ce050",
    ]

    /// UTF-8 → SHA-256 → 小写 hex。
    public static func sha256Hex(_ text: String) -> String {
        let digest = SHA256.hash(data: Data(text.utf8))
        var out = ""
        out.reserveCapacity(SHA256.Digest.byteCount * 2)
        for byte in digest {
            let hex = String(byte, radix: 16)
            out += byte < 0x10 ? "0" + hex : hex
        }
        return out
    }

    /// 渐进后缀候选："a.b.c" → ["c","b.c","a.b.c"]（最短在前）；空串 → 空表。
    public static func suffixCandidates(_ hostname: String) -> [String] {
        if hostname.isEmpty { return [] }
        let labels = hostname.components(separatedBy: ".")
        var candidates: [String] = []
        for i in stride(from: labels.count - 1, through: 0, by: -1) {
            candidates.append(labels[i...].joined(separator: "."))
        }
        return candidates
    }

    /// 任一候选的 sha256Hex 命中 allowedSha256 即 true；空主机名或空集恒 false（fail-closed）。
    public static func verify(_ hostname: String, allowedSha256: Set<String>) -> Bool {
        if allowedSha256.isEmpty { return false }
        return suffixCandidates(hostname).contains { allowedSha256.contains(sha256Hex($0)) }
    }
}
