import Foundation
import Core

/// 切换弹层行尾的两行到期读数。墨色与感叹圆跟 `expiry` 走（`captionInk` / `marksWarning`），
/// 与配置卡名称下那一行同一映射；选中行上怎么换见 `inks(on:)`。
struct ProfileExpiryTrail: Equatable {
    let date: String
    let remaining: String
    let expiry: ProfileExpiry
}

/// 配置元信息的展示文本。
///
/// 同一件事在配置页的摘要卡与列表行、首页配置选择器、配置详情里各画一次，故只有这一份实现：
/// 各处读同一个函数，不各写各的「已用/总量」「到期」「百分比」。
enum ProfileMetaText {
    /// 列表行的用量：`已用 / 总量 · 百分比`。无配额时如实说没有用量数据，不编一个 `0 / 0 · 0%`。
    ///
    /// 用尽时再追加一段「已用尽」，激活行也追加：名称转错误色只是颜色这一条通道，激活行连这一条
    /// 都让掉了；而这段字落在次级墨色上，两种行底都达标。
    static func usage(_ profile: Profile) -> String {
        guard profile.totalTraffic > 0 else { return tr("usage_none") }
        return markingExhausted(traffic(profile) + " · " + percent(profile), of: profile)
    }

    /// `已用 / 总量`；无配额（服务端未下发用量）时为空串，由调用方决定是否整段省略。
    static func traffic(_ profile: Profile) -> String {
        guard profile.totalTraffic > 0 else { return "" }
        return TrafficFormat.bytes(profile.usedTraffic) + trafficSeparator + TrafficFormat.bytes(profile.totalTraffic)
    }

    /// 已用与总量之间那一截。配置卡上两段字重不同、分开排，拼法仍只此一处。
    static let trafficSeparator = " / "

    /// 配置详情的用量值：`已用 / 总量`。无配额时同列表行，如实说没有用量数据，不编一个 `0 / 0`。
    ///
    /// 用尽时同列表行追加「已用尽」：详情的站标砖不因超额换警示号，超额的文字通道由这一段承担。
    static func usageDetail(_ profile: Profile) -> String {
        guard profile.totalTraffic > 0 else { return tr("usage_none") }
        return markingExhausted(traffic(profile), of: profile)
    }

    /// 列表行与详情的用量读数在用尽时同一拼法：读数后接「 · 已用尽」。
    private static func markingExhausted(_ reading: String, of profile: Profile) -> String {
        isExhausted(profile) ? reading + " · " + tr("usage_exhausted") : reading
    }

    /// 用量百分比文本，与配额条的填充同源（`UsageGauge.percent`）。
    /// 无配额时配额条对 `total <= 0` 是 fail-fast，门控在调用方。
    static func percent(_ profile: Profile) -> String {
        "\(UsageGauge.percent(used: profile.usedTraffic, total: profile.totalTraffic))%"
    }

    /// 配置详情的到期：`yyyy-MM-dd · N 天`，日期出 `UsageFormat`、天数出 core `ProfileExpiry`；同样不替缺失的到期信息下结论。
    static func expiryDetail(_ profile: Profile) -> String {
        let expiry = ProfileExpiry(expireTime: profile.expireTime, now: Int64(Date().timeIntervalSince1970))
        guard let date = UsageFormat.expiryDate(profile.expireTime), let days = expiry.daysLeft else { return tr("usage_no_expiry") }
        return date + " · " + tr("profiles_detail_days", String(days))
    }

    /// 配置卡名称下那一行：`到期 yyyy-MM-dd · N 天`；已到期写 `已到期 yyyy-MM-dd`，「0 天」读不出它已经过了；
    /// 没有到期时间如实说没有。
    ///
    /// **不说「本地文件不过期」**：那句话断言的是「这份配置来自本地文件」，而本仓只有 URL 导入
    /// 一条路，进程里没有任何东西能证明那件事。缺到期信息就说缺到期信息。
    ///
    /// 即将到期不另加字：屏上由警示色与图标承担，读屏补的那一句见 `spokenExpiry`。
    static func expiryCaption(_ profile: Profile, now: Int64) -> String {
        switch ProfileExpiry(expireTime: profile.expireTime, now: now) {
        case .none:
            tr("usage_no_expiry")
        case .expired:
            tr("usage_expired") + " " + expiryDay(profile)
        case .normal(let days), .soon(let days):
            tr("usage_expiry") + " " + expiryDay(profile) + " · " + tr("profiles_detail_days", String(days))
        }
    }

    /// 读屏的到期那一句：即将到期在句首补「即将到期」——屏上那一档只在颜色与图标里，读屏听不到。
    static func spokenExpiry(_ profile: Profile, now: Int64) -> String {
        let caption = expiryCaption(profile, now: now)
        guard case .soon = ProfileExpiry(expireTime: profile.expireTime, now: now) else { return caption }
        return tr("usage_expiring_soon") + ", " + caption
    }

    /// 配置卡读屏的用量：`已用 X, 总量 Y, N%`，用尽时末段读「已用尽」；无配额如实说没有用量数据。
    /// 屏上那一行的「/」与「·」读出来是「斜杠」「点」，读屏换成带标签的一句；配额条不进读屏，百分比由这一句说。
    /// 两端同一读法（Android `profileSpokenUsage`）。
    static func spokenUsage(_ profile: Profile) -> String {
        guard profile.totalTraffic > 0 else { return tr("usage_none") }
        return [
            tr("usage_used") + " " + TrafficFormat.bytes(profile.usedTraffic),
            tr("usage_total") + " " + TrafficFormat.bytes(profile.totalTraffic),
            isExhausted(profile) ? tr("usage_exhausted") : percent(profile),
        ].joined(separator: ", ")
    }

    /// 配置卡的读屏值：用量一句，接着到期一句。
    static func spokenReadings(_ profile: Profile, now: Int64) -> String {
        spokenUsage(profile) + "; " + spokenExpiry(profile, now: now)
    }

    /// 首页配置卡在能切换时的读屏提示。
    static var switchHint: String { tr("home_profile_hint") }

    /// 切换弹层行尾的到期读数：上一行日期，下一行剩余天数；已到期写「已到期」，没有到期时间两行都是占位符。
    static func expiryTrail(_ profile: Profile, now: Int64) -> ProfileExpiryTrail {
        let expiry = ProfileExpiry(expireTime: profile.expireTime, now: now)
        switch expiry {
        case .none:
            return ProfileExpiryTrail(date: StatsViewModel.placeholder, remaining: StatsViewModel.placeholder, expiry: expiry)
        case .expired:
            return ProfileExpiryTrail(date: expiryDay(profile), remaining: tr("usage_expired"), expiry: expiry)
        case .normal(let days), .soon(let days):
            return ProfileExpiryTrail(date: expiryDay(profile), remaining: tr("profiles_detail_days", String(days)), expiry: expiry)
        }
    }

    /// 只有带到期时间的档位走到这里：到期时刻为正，必有日历日。
    private static func expiryDay(_ profile: Profile) -> String {
        guard let day = UsageFormat.expiryDate(profile.expireTime) else {
            preconditionFailure("expiry standing without a calendar day")
        }
        return day
    }

    /// 配额是否已耗尽。**只回答配额问题，不复述谁跟着转色** —— 承载者各自有各自的条件
    /// （名称见 `nameShowsExhausted(_:isActive:)`），在这里再写一遍只会多一个会漂的复述点。
    static func isExhausted(_ profile: Profile) -> Bool {
        profile.totalTraffic > 0 && profile.usedTraffic >= profile.totalTraffic
    }

    /// 名称是否用错误色。**比 `isExhausted` 多一个条件：激活行不转。**
    ///
    /// 理由是对比度，不是版式偏好：激活行整块铺 `accentContainer`，错误前景压它两态都不达标，
    /// 而摘要卡的配额条是非文本承载者、按更松的那档判 ⇒ 当前配置的超额信号由它与用量行的「已用尽」
    /// 承担，只是不由名字说。
    static func nameShowsExhausted(_ profile: Profile, isActive: Bool) -> Bool {
        isExhausted(profile) && !isActive
    }
}
