package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.ProfileExpiry
import cloud.oneoh.oneboxn.core.TrafficFormat
import cloud.oneoh.oneboxn.ui.components.UsageGauge

// 配置元信息的展示文本。同一件事在配置页的摘要卡与列表行、配置详情里各画一次，
// 故只有这一份实现：各处读同一组函数，不各写各的「已用/总量」「到期」「百分比」。
//
// 服务端没下发到期信息时只说「无到期信息」，**不声称这份配置的来源**——导入只有 `GET url` 一条路
// （`ImportLink.parse` 的接受分支都要求 `https://`），进程里没有任何东西能证明一份配置来自本地文件；
// 缺 `expire` 头（缺失或畸形 → 0）只说明服务端没给到期时间，与来源无关。
//
// 取字符串的那一半是纯函数，好让 JVM 单测够得到；`@Composable` 那一半只负责从资源里取文案。

/**
 * 把两段拼成一行元信息，**空段整段省略、不留分隔点**。
 * 取字符串、不取 `Profile`，与 Apple `ProfileMetaText` 同形。
 */
internal fun joinProfileMeta(quota: String, expiry: String): String =
    listOf(quota, expiry).filter { it.isNotEmpty() }.joinToString(META_SEPARATOR)

/** `已用 / 总量`；无配额（服务端未下发用量）时为空串，由调用方决定是否整段省略。 */
internal fun profileTraffic(profile: Profile): String =
    if (profile.totalTraffic > 0) {
        TrafficFormat.bytes(profile.usedTraffic) + " / " + TrafficFormat.bytes(profile.totalTraffic)
    } else {
        ""
    }

/** 用量百分比，与配额条的填充同源（`UsageGauge.percent`）；无配额时配额条 fail-fast，门控在调用方。 */
internal fun profilePercent(profile: Profile): String =
    "${UsageGauge.percent(profile.usedTraffic, profile.totalTraffic)}%"

/** 用量行里两句取自资源的文案：无配额时的那一句、用尽时追加的那一段。 */
internal data class UsageLineText(val noUsage: String, val exhausted: String)

/**
 * 列表行的用量：`已用 / 总量 · 百分比`。无配额时如实说没有用量数据，不编一个 `0 / 0 · 0%`。
 *
 * 用尽时再追加一段「已用尽」，当前行也追加：名称转错误色只是颜色这一条通道，当前行连这一条
 * 都让掉了；而这段字落在次级墨色上，两种行底都达标。
 */
internal fun profileUsageLine(profile: Profile, text: UsageLineText): String {
    if (profile.totalTraffic <= 0) return text.noUsage
    return markingExhausted(joinProfileMeta(profileTraffic(profile), profilePercent(profile)), profile, text)
}

/**
 * 配置详情的用量值：`已用 / 总量`。无配额时同列表行，如实说没有用量数据，不编一个 `0 / 0`。
 *
 * 用尽时同列表行追加「已用尽」：详情的站标砖不因超额换警示号，超额的文字通道由这一段承担。
 */
internal fun profileUsageDetail(profile: Profile, text: UsageLineText): String {
    if (profile.totalTraffic <= 0) return text.noUsage
    return markingExhausted(profileTraffic(profile), profile, text)
}

/** 列表行与详情的用量读数在用尽时同一拼法：读数后接「 · 已用尽」。 */
private fun markingExhausted(reading: String, profile: Profile, text: UsageLineText): String =
    when (quotaState(profile)) {
        QuotaState.EXCEEDED -> joinProfileMeta(reading, text.exhausted)
        QuotaState.WITHIN -> reading
    }

@Composable
internal fun profileUsageOf(profile: Profile): String = profileUsageLine(profile, usageLineText())

@Composable
internal fun profileUsageDetailOf(profile: Profile): String = profileUsageDetail(profile, usageLineText())

@Composable
private fun usageLineText() = UsageLineText(
    noUsage = stringResource(R.string.usage_none),
    exhausted = stringResource(R.string.usage_exhausted),
)

/** 配置卡读屏的用量那一句里取自资源的几段。 */
internal data class SpokenUsageText(val used: String, val total: String, val noUsage: String, val exhausted: String)

/**
 * 配置卡读屏的用量：`已用 X, 总量 Y, N%`，用尽时末段读「已用尽」；无配额如实说没有用量数据。
 * 配额条不进读屏，百分比由这一句说。
 */
internal fun profileSpokenUsage(profile: Profile, text: SpokenUsageText): String {
    if (profile.totalTraffic <= 0) return text.noUsage
    val share = when (quotaState(profile)) {
        QuotaState.EXCEEDED -> text.exhausted
        QuotaState.WITHIN -> profilePercent(profile)
    }
    return listOf(
        text.used + " " + TrafficFormat.bytes(profile.usedTraffic),
        text.total + " " + TrafficFormat.bytes(profile.totalTraffic),
        share,
    ).joinToString(SPOKEN_SEPARATOR)
}

@Composable
internal fun profileSpokenUsageOf(profile: Profile): String = profileSpokenUsage(
    profile,
    SpokenUsageText(
        used = stringResource(R.string.usage_used),
        total = stringResource(R.string.usage_total),
        noUsage = stringResource(R.string.usage_none),
        exhausted = stringResource(R.string.usage_exhausted),
    ),
)

/** 配置详情到期行里两句取自资源的文案：没有到期信息时的那一句、剩余天数那一段。 */
internal data class ExpiryDetailText(val noExpiry: String, val daysLeft: String)

/** 配置详情的到期：`yyyy-MM-dd · N 天`；同样不替缺失的到期信息下结论，不落成一个 1970 年的日期加 0 天。 */
internal fun profileExpiryDetail(profile: Profile, text: ExpiryDetailText): String =
    if (profile.expireTime > 0) joinProfileMeta(expiryDateLabel(profile.expireTime), text.daysLeft) else text.noExpiry

@Composable
internal fun profileExpiryDetailOf(profile: Profile): String {
    val daysLeft = ProfileExpiry.of(profile.expireTime, System.currentTimeMillis() / MILLIS_PER_SECOND).daysLeft
    return profileExpiryDetail(
        profile,
        ExpiryDetailText(
            noExpiry = stringResource(R.string.usage_no_expiry),
            daysLeft = daysLeft?.let { stringResource(R.string.profiles_detail_days, it.toString()) }.orEmpty(),
        ),
    )
}

/** 配置卡到期那一行里取自资源的四段：没有到期时间、「到期」、「已到期」、剩余天数。 */
internal data class ExpiryCaptionText(val noExpiry: String, val expires: String, val expired: String, val daysLeft: String)

/**
 * 配置卡名称下那一行：`到期 yyyy-MM-dd · N 天`；已到期写 `已到期 yyyy-MM-dd`，「0 天」读不出它已经过了；
 * 没有到期时间如实说没有。
 *
 * 即将到期不另加字：屏上由警示色与图标承担，读屏补的那一句见 [profileSpokenExpiry]。
 */
internal fun profileExpiryCaption(profile: Profile, expiry: ProfileExpiry, text: ExpiryCaptionText): String =
    when (expiry) {
        ProfileExpiry.None -> text.noExpiry
        ProfileExpiry.Expired -> text.expired + " " + expiryDateLabel(profile.expireTime)
        is ProfileExpiry.Normal, is ProfileExpiry.Soon ->
            joinProfileMeta(text.expires + " " + expiryDateLabel(profile.expireTime), text.daysLeft)
    }

/** 读屏的到期那一句：即将到期在句首补「即将到期」——屏上那一档只在颜色与图标里，读屏听不到。 */
internal fun profileSpokenExpiry(expiry: ProfileExpiry, caption: String, expiringSoon: String): String =
    if (expiry is ProfileExpiry.Soon) "$expiringSoon, $caption" else caption

@Composable
internal fun profileExpiryCaptionOf(profile: Profile, now: Long): String {
    val expiry = ProfileExpiry.of(profile.expireTime, now)
    return profileExpiryCaption(profile, expiry, expiryCaptionText(expiry))
}

@Composable
internal fun profileSpokenExpiryOf(profile: Profile, now: Long): String {
    val expiry = ProfileExpiry.of(profile.expireTime, now)
    val caption = profileExpiryCaption(profile, expiry, expiryCaptionText(expiry))
    return profileSpokenExpiry(expiry, caption, stringResource(R.string.usage_expiring_soon))
}

@Composable
private fun expiryCaptionText(expiry: ProfileExpiry) = ExpiryCaptionText(
    noExpiry = stringResource(R.string.usage_no_expiry),
    expires = stringResource(R.string.usage_expiry),
    expired = stringResource(R.string.usage_expired),
    daysLeft = expiry.daysLeft?.let { stringResource(R.string.profiles_detail_days, it.toString()) }.orEmpty(),
)

/** 配置卡到期那一行的强调档。整卡不换色，到期问题只动这一行。 */
internal enum class ExpiryEmphasis {
    /** 次级色，不配图标。 */
    QUIET,

    /** 即将到期：警示前景配实心感叹圆。 */
    WARNING,

    /** 已到期：错误前景配同一枚图标。 */
    ERROR,
}

internal fun expiryEmphasis(expiry: ProfileExpiry): ExpiryEmphasis = when (expiry) {
    ProfileExpiry.None, is ProfileExpiry.Normal -> ExpiryEmphasis.QUIET
    is ProfileExpiry.Soon -> ExpiryEmphasis.WARNING
    ProfileExpiry.Expired -> ExpiryEmphasis.ERROR
}

/** 切换弹层行尾两行里取自资源的两段：「已到期」、剩余天数（没有剩余天数的档位取空串）。 */
internal data class ExpiryTrailText(val expired: String, val daysLeft: String)

/**
 * 切换弹层行尾的到期读数：上一行日期，下一行剩余；强调档与配置卡名称下那一行同一映射（[expiryEmphasis]）。
 * 选中行的字回正文色、感叹圆保留状态色由行自己决定。
 */
internal data class ExpiryTrail(val date: String, val remaining: String, val emphasis: ExpiryEmphasis)

/** 已到期写「已到期」而不是「0 天」；没有到期时间两行都是占位符，不落成一个 1970 年的日期。 */
internal fun profileExpiryTrail(profile: Profile, expiry: ProfileExpiry, text: ExpiryTrailText): ExpiryTrail = when (expiry) {
    ProfileExpiry.None -> ExpiryTrail(StatsViewModel.PLACEHOLDER, StatsViewModel.PLACEHOLDER, expiryEmphasis(expiry))
    ProfileExpiry.Expired -> ExpiryTrail(expiryDateLabel(profile.expireTime), text.expired, expiryEmphasis(expiry))
    is ProfileExpiry.Normal, is ProfileExpiry.Soon ->
        ExpiryTrail(expiryDateLabel(profile.expireTime), text.daysLeft, expiryEmphasis(expiry))
}

@Composable
internal fun profileExpiryTrailOf(profile: Profile, now: Long): ExpiryTrail {
    val expiry = ProfileExpiry.of(profile.expireTime, now)
    return profileExpiryTrail(
        profile,
        expiry,
        ExpiryTrailText(
            expired = stringResource(R.string.usage_expired),
            daysLeft = expiry.daysLeft?.let { stringResource(R.string.profiles_detail_days, it.toString()) }.orEmpty(),
        ),
    )
}

/** 到期档位的状态色：配置卡的注脚与感叹圆、切换弹层行尾的感叹圆都取这一份。 */
internal fun expiryInk(emphasis: ExpiryEmphasis, colors: AppColors, tones: ExtendedTones): Color = when (emphasis) {
    ExpiryEmphasis.QUIET -> colors.textSecondary
    ExpiryEmphasis.WARNING -> tones.warning.fg
    ExpiryEmphasis.ERROR -> tones.error.fg
}

/**
 * 到期读数的字色随底：选中行铺 `accentContainer`，状态色压它不达标（亮态 warning `4.41`、error `4.27`），
 * 字回正文色。感叹圆是非文本图形（门槛 `3 : 1`），仍取 [markInk]——状态照旧有图标与文字两条通道。
 */
internal fun expiryTextInk(markInk: Color, on: SecondaryTextSurface, colors: AppColors): Color = when (on) {
    SecondaryTextSurface.Plain -> markInk
    SecondaryTextSurface.AccentContainer -> colors.textPrimary
}

/** 首页配置卡在能切换时的读屏提示。 */
@Composable
internal fun profileSwitchHint(): String = stringResource(R.string.home_profile_hint)

/**
 * 配额状态。**用枚举而不是布尔**：调用点写 `QuotaState.EXCEEDED` 读得出「超额了」，
 * 写 `overQuota = true` 只读得出「某个开关是真」。
 */
enum class QuotaState { WITHIN, EXCEEDED }

/** 配额是否已耗尽；谁跟着转色由承载者各自决定，这里只回答配额问题。 */
internal fun quotaState(profile: Profile): QuotaState =
    if (profile.totalTraffic > 0 && profile.usedTraffic >= profile.totalTraffic) {
        QuotaState.EXCEEDED
    } else {
        QuotaState.WITHIN
    }

private const val META_SEPARATOR = " · "

/** 读屏一句里各段之间：与 [profileSpokenExpiry] 同一个分隔。 */
private const val SPOKEN_SEPARATOR = ", "
