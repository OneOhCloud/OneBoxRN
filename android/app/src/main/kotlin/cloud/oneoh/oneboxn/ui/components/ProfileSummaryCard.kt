package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.Profile
import cloud.oneoh.oneboxn.core.ProfileDestination
import cloud.oneoh.oneboxn.core.ProfileExpiry
import cloud.oneoh.oneboxn.core.TrafficFormat
import cloud.oneoh.oneboxn.ui.ExpiryEmphasis
import cloud.oneoh.oneboxn.ui.LinkOpenFailedDialog
import cloud.oneoh.oneboxn.ui.MILLIS_PER_SECOND
import cloud.oneoh.oneboxn.ui.QuotaState
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.cardSurface
import cloud.oneoh.oneboxn.ui.expiryEmphasis
import cloud.oneoh.oneboxn.ui.expiryInk
import cloud.oneoh.oneboxn.ui.openExternalLink
import cloud.oneoh.oneboxn.ui.profileExpiryCaptionOf
import cloud.oneoh.oneboxn.ui.profilePercent
import cloud.oneoh.oneboxn.ui.profileSpokenExpiryOf
import cloud.oneoh.oneboxn.ui.profileSpokenUsageOf
import cloud.oneoh.oneboxn.ui.profileSwitchHint
import cloud.oneoh.oneboxn.ui.quotaState
import cloud.oneoh.oneboxn.ui.tabular
import com.microsoft.fluent.mobile.icons.R as FluentR

/**
 * 当前配置卡：回答「现在用的是哪一份、还剩多少、哪天到期」。配置页页顶与首页未连接时的组位共用这一张。
 *
 * 坐进首页卡同一副网格（[HomeCardGrid]）：上排站标砖 + 名称 + 到期注脚，下排读数带写流量。
 * 与会话卡、失败卡同高，连上之后原位换内容，组位不跳。到期问题只动注脚、流量问题只动读数带，整卡不换色。
 * 无障碍字号档改竖排：网格那一排容不下放大后的名称与读数。
 *
 * 站标砖是叠在卡身上的另一个按钮：点开去向（配置站点，没有站点时 [productWebsite]，与关于页「官网」行同一来源）。
 * 卡身做什么由 [body] 定。
 */
@Composable
fun ProfileSummaryCard(
    profile: Profile,
    productWebsite: String,
    body: SummaryCardBody,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var linkFailed by remember { mutableStateOf(false) }
    // 与配置详情头部同一入口：去向由 core 按站点定，砖上画什么由共用的站标砖按去向与站标缓存定。
    val destination = remember(profile.website, productWebsite) {
        ProfileDestination.of(profile.website, productWebsite)
    }
    val now = System.currentTimeMillis() / MILLIS_PER_SECOND
    val stacked = Theme.isAccessibilityFontScale
    val tile = SiteTileMetrics(
        if (stacked) STACKED_TILE else ProfileMarkTileMetrics(HomeCardMetrics.badgeDiameter(), Theme.Radius.control),
    )
    // 砖与卡身是两个停点，砖不进卡身的合并语义；读屏先停砖，再停卡身。
    Box(modifier.fillMaxWidth().semantics { isTraversalGroup = true }) {
        if (stacked) {
            StackedBody(profile, now, body)
        } else {
            GridBody(profile, now, body)
        }
        SiteTile(
            destination = destination,
            metrics = tile,
            onClick = { if (!openExternalLink(context, destination.url)) linkFailed = true },
        )
    }
    if (linkFailed) {
        LinkOpenFailedDialog(onDismiss = { linkFailed = false })
    }
}

/** 卡身点按做什么。 */
sealed interface SummaryCardBody {
    /** 配置页：卡身不可点，下面就是切换列表。 */
    data object Static : SummaryCardBody

    /** 首页两份以上配置：卡身点开切换配置，名称行尾画「›」，与会话卡的节点行同义。 */
    data class SwitchProfile(val onClick: () -> Unit) : SummaryCardBody
}

/**
 * 卡面、按下反馈与卡身的读屏：名字读「当前配置，名称」，值读用量与到期。
 * 名称上方没有可见标题，读屏用户没有位置线索，那一句只在这里说。
 */
@Composable
private fun Modifier.summaryCardBody(profile: Profile, now: Long, body: SummaryCardBody): Modifier {
    val label = stringResource(R.string.home_profile) + ", " + profile.name
    val reading = profileSpokenUsageOf(profile) + "; " + profileSpokenExpiryOf(profile, now)
    return when (body) {
        SummaryCardBody.Static -> cardSurface(HomeCardMetrics.radius)
            .semantics(mergeDescendants = true) {
                contentDescription = label
                stateDescription = reading
            }
        is SummaryCardBody.SwitchProfile -> {
            val interactionSource = remember { MutableInteractionSource() }
            clip(HomeCardMetrics.shape)
                .background(pressedFill(interactionSource, Theme.colors.surface), HomeCardMetrics.shape)
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    role = Role.Button,
                    onClickLabel = profileSwitchHint(),
                    onClick = body.onClick,
                )
                .semantics {
                    contentDescription = label
                    stateDescription = reading
                }
        }
    }
}

/** 网格版式：与会话卡同一副排法，站标砖占圆位那一格。 */
@Composable
private fun GridBody(profile: Profile, now: Long, body: SummaryCardBody) {
    HomeCardGrid(
        modifier = Modifier.summaryCardBody(profile, now, body),
        top = { diameter ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxSize().clearAndSetSemantics {},
            ) {
                // 站标砖叠在这一格上（它是另一个按钮，不进卡身），这里只把位置留出来。
                Spacer(Modifier.size(diameter))
                Column(
                    verticalArrangement = Arrangement.spacedBy(HomeCardMetrics.nameToCaption),
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = HomeCardMetrics.badgeToTitle),
                ) {
                    ProfileName(profile, maxLines = 1)
                    ExpiryCaption(profile, now, maxLines = 1)
                }
                if (body is SummaryCardBody.SwitchProfile) {
                    Spacer(Modifier.width(HomeCardMetrics.titleToChevron))
                    HomeCardChevron()
                }
            }
        },
        band = { QuotaBand(profile, Modifier.fillMaxSize().clearAndSetSemantics {}) },
    )
}

/** 竖排版式：砖单独一行取详情头部那一档，名称最多三行，到期与读数允许折行，配额条仍在最下。 */
@Composable
private fun StackedBody(profile: Profile, now: Long, body: SummaryCardBody) {
    Box(
        modifier = Modifier
            .summaryCardBody(profile, now, body)
            .fillMaxWidth()
            .padding(HomeCardMetrics.inset),
    ) {
        Column(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                // 站标砖叠在这一格上，这里只把位置留出来。
                Spacer(Modifier.size(STACKED_TILE.side))
                Spacer(Modifier.weight(1f))
                if (body is SummaryCardBody.SwitchProfile) HomeCardChevron()
            }
            Spacer(Modifier.height(Theme.Spacing.md))
            ProfileName(profile, maxLines = STACKED_NAME_LINES)
            Spacer(Modifier.height(Theme.Spacing.xs))
            ExpiryCaption(profile, now, maxLines = Int.MAX_VALUE)
            Spacer(Modifier.height(Theme.Spacing.lg))
            if (profile.totalTraffic <= 0) {
                NoUsageNote(maxLines = Int.MAX_VALUE)
            } else {
                UsedOfTotal(profile, maxLines = Int.MAX_VALUE)
                QuotaShare(profile)
                Spacer(Modifier.height(Theme.Spacing.sm))
                UsageGauge(usedBytes = profile.usedTraffic, totalBytes = profile.totalTraffic)
            }
        }
    }
}

@Composable
private fun ProfileName(profile: Profile, maxLines: Int) {
    Text(
        text = profile.name,
        style = Theme.Type.sheetTitle,
        color = Theme.colors.textPrimary,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * 名称下的到期注脚。即将到期与已到期在字前配一枚实心感叹圆，颜色只是冗余通道。
 * 感叹圆排进文字里而不是另起一格：竖排折行时它跟着第一行走，不在几行之间居中。
 */
@Composable
private fun ExpiryCaption(profile: Profile, now: Long, maxLines: Int) {
    val emphasis = expiryEmphasis(ProfileExpiry.of(profile.expireTime, now))
    val color = expiryInk(emphasis, Theme.colors, Theme.tones)
    val caption = profileExpiryCaptionOf(profile, now)
    val style = Theme.Type.subtitle.tabular()
    val marked = emphasis != ExpiryEmphasis.QUIET
    Text(
        text = if (marked) {
            buildAnnotatedString {
                appendInlineContent(EXPIRY_MARK)
                append(caption)
            }
        } else {
            AnnotatedString(caption)
        },
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        inlineContent = if (marked) mapOf(EXPIRY_MARK to expiryMark(color, style.fontSize.value)) else emptyMap(),
    )
}

/** 感叹圆占一个字高，其后留出 `Spacing.xs` 再接文字；两者都按字号折成 em，随字号一起缩放。 */
private fun expiryMark(tint: Color, fontSize: Float): InlineTextContent {
    val gap = Theme.Spacing.xs.value / fontSize
    return InlineTextContent(
        Placeholder(width = (1f + gap).em, height = 1.em, placeholderVerticalAlign = PlaceholderVerticalAlign.TextCenter),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
            Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_error_circle_12_filled),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.fillMaxHeight().aspectRatio(1f),
            )
        }
    }
}

/**
 * 读数带：`已用 / 总量` 与百分比一行，下面是配额条。
 * 无配额（服务端未下发用量）是合法业务态：配额条对 `total <= 0` 是 fail-fast，门控在这里；
 * 只留一行说明贴带底（与失败卡说明同位），不画空条。
 */
@Composable
private fun QuotaBand(profile: Profile, modifier: Modifier) {
    if (profile.totalTraffic <= 0) {
        Box(modifier, contentAlignment = Alignment.BottomStart) { NoUsageNote(maxLines = 1) }
        return
    }
    Column(verticalArrangement = Arrangement.SpaceBetween, modifier = modifier) {
        Row(modifier = Modifier.fillMaxWidth()) {
            UsedOfTotal(
                profile = profile,
                maxLines = 1,
                modifier = Modifier
                    .weight(1f)
                    .alignByBaseline(),
            )
            QuotaShare(profile, Modifier.alignByBaseline())
        }
        UsageGauge(usedBytes = profile.usedTraffic, totalBytes = profile.totalTraffic)
    }
}

/** 已用是主读数（`15/600`），「 / 总量」是它的注脚（`13/400` 次级色）。 */
@Composable
private fun UsedOfTotal(profile: Profile, maxLines: Int, modifier: Modifier = Modifier) {
    val total = Theme.Type.status.copy(fontWeight = FontWeight.Normal).tabular()
        .toSpanStyle().copy(color = Theme.colors.textSecondary)
    Text(
        text = buildAnnotatedString {
            append(TrafficFormat.bytes(profile.usedTraffic))
            withStyle(total) { append(" / " + TrafficFormat.bytes(profile.totalTraffic)) }
        },
        style = Theme.Type.rowTitle.copy(fontWeight = FontWeight.SemiBold).tabular(),
        color = Theme.colors.textPrimary,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

/** 读数带右端：百分比；用尽时换成「已用尽」——只有红条与「100%」时说不出它已经用完。 */
@Composable
private fun QuotaShare(profile: Profile, modifier: Modifier = Modifier) {
    when (quotaState(profile)) {
        QuotaState.EXCEEDED -> Text(
            text = stringResource(R.string.usage_exhausted),
            style = Theme.Type.status,
            color = Theme.tones.error.fg,
            modifier = modifier,
        )
        QuotaState.WITHIN -> Text(
            text = profilePercent(profile),
            style = Theme.Type.status.tabular(),
            color = Theme.colors.textPrimary,
            modifier = modifier,
        )
    }
}

@Composable
private fun NoUsageNote(maxLines: Int) {
    Text(
        text = stringResource(R.string.usage_none),
        style = Theme.Type.status.copy(fontWeight = FontWeight.Normal),
        color = Theme.colors.textSecondary,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * 站标砖，右下角挂外跳角标，叠在卡身圆位那一格上（两种版式都在卡内衬的左上角）。
 * 读屏只停这块砖一次、且先于卡身：角标不带语义，不单独成停点。
 *
 * 点按区是压在砖上的一块透明区，按 [SiteTileMetrics.hitArea] 大过砖、包住角标；它不参与测量，
 * 名称的位置不动。按下波纹仍只画在砖上。
 */
@Composable
private fun SiteTile(
    destination: ProfileDestination,
    metrics: SiteTileMetrics,
    onClick: () -> Unit,
) {
    val label = destination.tileLabel(productWebsiteLabel = stringResource(R.string.settings_website))
    val interactions = remember { MutableInteractionSource() }
    val hit = metrics.hitArea
    Box(
        Modifier
            .padding(HomeCardMetrics.inset)
            .semantics { traversalIndex = -1f },
    ) {
        ProfileMarkTile(
            destination = destination,
            metrics = metrics.mark,
            seat = MarkTileSeat.CARD,
            interactionSource = interactions,
        )
        LinkBadge(
            metrics = metrics,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = metrics.badgeOutset, y = metrics.badgeOutset),
        )
        Box(
            Modifier
                .matchParentSize()
                .wrapContentSize(Alignment.TopStart, unbounded = true)
                .offset(x = -hit.leadingOutset, y = -hit.leadingOutset)
                .size(hit.side)
                .clickable(interactions, indication = null, role = Role.Button, onClick = onClick)
                .semantics { contentDescription = label },
        )
    }
}

/** 站标砖的读屏标签：配置站点读主机名；产品官网读「官网」——那个主机名是产品的，说不出这份配置的来历。 */
internal fun ProfileDestination.tileLabel(productWebsiteLabel: String): String = when (this) {
    is ProfileDestination.ProfileSite -> hostname
    is ProfileDestination.ProductWebsite -> productWebsiteLabel
}

/** 外跳角标：`accent` 圆底上一枚 `onAccent` 的 ↗，说「点这块砖去外面」。 */
@Composable
private fun LinkBadge(metrics: SiteTileMetrics, modifier: Modifier) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(metrics.badgeSide)
            .clip(Theme.Radius.pill)
            .background(Theme.colors.accent),
    ) {
        Icon(
            painter = painterResource(FluentR.drawable.ic_fluent_arrow_up_right_12_filled),
            contentDescription = null,
            tint = Theme.colors.onAccent,
            modifier = Modifier.size(metrics.badgeGlyph),
        )
    }
}

/** 竖排时砖单独一行，取详情头部那一档。 */
private val STACKED_TILE = ProfileMarkTileMetrics.detailHeader

/** 竖排时名称最多几行：再多就把读数挤出一屏。 */
private const val STACKED_NAME_LINES = 3

private const val EXPIRY_MARK = "expiryMark"

/**
 * 站标砖连同外跳角标的尺寸账。角标随砖边同比：基准砖 `40` 上直径 `16`、↗ `8`、向右下各外扩 `4`（与 iOS 同值）。
 */
internal class SiteTileMetrics(val mark: ProfileMarkTileMetrics) {
    val badgeSide: Dp get() = scaled(REFERENCE_BADGE_SIDE)
    val badgeGlyph: Dp get() = scaled(REFERENCE_BADGE_GLYPH)
    val badgeOutset: Dp get() = scaled(REFERENCE_BADGE_OUTSET)
    val hitArea: LinkTileHitArea get() = LinkTileHitArea(mark.side, badgeOutset, MINIMUM_HIT_SIDE)

    private fun scaled(reference: Dp): Dp = reference * (mark.side / REFERENCE_TILE_SIDE)

    companion object {
        /** 平台建议的最小触控目标 `48 × 48`。 */
        val MINIMUM_HIT_SIDE = 48.dp
    }
}

private val REFERENCE_TILE_SIDE = 40.dp
private val REFERENCE_BADGE_SIDE = 16.dp
private val REFERENCE_BADGE_GLYPH = 8.dp
private val REFERENCE_BADGE_OUTSET = 4.dp

/**
 * 站标砖的点按区（Apple 对等物同名）：砖连同外扩的角标取外接方框，不足下限时四边等量扩到下限。
 * 扩出的部分只进命中、不进版式：名称的位置不动，点按区的右沿也停在名称之前。
 */
internal class LinkTileHitArea(tileSide: Dp, badgeOutset: Dp, minimumSide: Dp) {
    private val growth = ((minimumSide - (tileSide + badgeOutset)) / 2).coerceAtLeast(0.dp)

    /** 点按区左上角在砖左上角之外多远。 */
    val leadingOutset: Dp = growth

    /** 点按区右下角在砖右下角之外多远：角标的外扩也在里面。 */
    val trailingOutset: Dp = badgeOutset + growth
    val side: Dp = tileSide + badgeOutset + growth * 2
}
