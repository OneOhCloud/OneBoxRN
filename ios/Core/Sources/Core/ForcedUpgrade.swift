import Foundation

// 强制升级判定：已导入的配置全部来自指定来源时，本客户端不再服务，须换用新版。
// 来源只以 sha256 参与判定（域名保密），后缀匹配规则沿用 DomainVerify。
// 与 Android core/ForcedUpgrade.kt 逐字对应，golden/forced-upgrade.json 是行为裁判。

public enum ForcedUpgrade {
    /// 来源集：仅存 sha256 小写 hex，且必须是 DomainVerify.TRUSTED_SHA256 的子集；本仓任何处不得出现其原像信息。
    public static let SOURCE_SHA256: Set<String> = [
        "61e245b4e5c234b00865ab0f47ad1cc4a9b37dbc50159febea7e6dcaee8ce050",
    ]

    /// 至少一份配置，且每份配置地址的主机名都命中来源集。
    public static func isRequired(profileUrls: [String], sourceSha256: Set<String> = SOURCE_SHA256) -> Bool {
        !profileUrls.isEmpty
            && profileUrls.allSatisfy { DomainVerify.verify(UrlInfo.hostname($0), allowedSha256: sourceSha256) }
    }
}
