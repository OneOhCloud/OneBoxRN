package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.ProfileDestination
import cloud.oneoh.oneboxn.core.ProfileMark
import cloud.oneoh.oneboxn.core.SiteIconEntry
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.siteIconCache
import com.microsoft.fluent.mobile.icons.R as FluentR

/**
 * 站标砖（Apple 对等物 `ProfileMarkTile`）：画什么由 [ProfileDestination.mark] 定。站标按比例内嵌、与砖同心，
 * 托底按砖坐在什么上给（[MarkTileSeat]）；回落字形是 `accent` 压 `accentContainer`。
 *
 * 站标的结局按地址缓存在 `siteIconCache`，再打开同一份详情不重打、也不先闪回落图标；
 * 去向换了（切换当前配置）即按新地址取，旧地址的结局不串到新砖上。
 *
 * 砖只画、不接点击：点按区由调用方按所在版式给（可以大过砖），按下波纹经 [interactionSource] 仍只画在砖上。
 */
@Composable
fun ProfileMarkTile(
    destination: ProfileDestination,
    metrics: ProfileMarkTileMetrics,
    seat: MarkTileSeat,
    interactionSource: InteractionSource,
    modifier: Modifier = Modifier,
) {
    val iconAddress = (destination as? ProfileDestination.ProfileSite)?.iconAddress
    var settled by remember { mutableStateOf<Pair<String, SiteIconEntry<ImageBitmap>>?>(null) }
    LaunchedEffect(iconAddress) {
        if (iconAddress != null) settled = iconAddress to siteIconCache.entry(iconAddress)
    }
    val mark = destination.mark { address ->
        settled?.takeIf { it.first == address }?.second ?: siteIconCache.known(address)
    }
    Box(
        modifier = modifier
            .size(metrics.side)
            .clip(RoundedCornerShape(metrics.radius))
            .background(plateOf(mark, seat))
            .indication(interactionSource, LocalIndication.current),
        contentAlignment = Alignment.Center,
    ) {
        when (mark) {
            is ProfileMark.SiteIcon -> Image(
                bitmap = mark.image,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                filterQuality = FilterQuality.High,
                modifier = Modifier
                    .size(metrics.siteIconSide)
                    .clip(RoundedCornerShape(metrics.siteIconRadius)),
            )
            ProfileMark.Globe -> Icon(
                painter = painterResource(FluentR.drawable.ic_fluent_globe_24_regular),
                contentDescription = null,
                tint = Theme.colors.accent,
                modifier = Modifier.size(metrics.globeGlyph),
            )
            ProfileMark.BrandMark -> Icon(
                painter = painterResource(R.drawable.ic_brand_mark),
                contentDescription = null,
                tint = Theme.colors.accent,
                modifier = Modifier.size(metrics.brandMarkSide),
            )
        }
    }
}

/**
 * 站标砖坐在什么上。站标的托底要与所坐的底拉开：同色时有站标的砖形整个消失，只剩一枚小图，
 * 与地球、品牌标两种砖不同大。
 */
enum class MarkTileSeat {
    /** 页面或弹层的底上（配置详情头部）：托 `surface`。 */
    PAGE,

    /** 卡面（`surface`）上（配置卡）：托 `fill`。 */
    CARD,
}

@Composable
private fun plateOf(mark: ProfileMark<ImageBitmap>, seat: MarkTileSeat): Color = when (mark) {
    is ProfileMark.SiteIcon -> when (seat) {
        MarkTileSeat.PAGE -> Theme.colors.surface
        MarkTileSeat.CARD -> Theme.colors.fill
    }
    ProfileMark.Globe, ProfileMark.BrandMark -> Theme.colors.accentContainer
}

/** 站标砖的尺寸账：边长与圆角由调用方从主题取，砖内各项按详情头部那块 `64` 砖的比例随边长导出。 */
data class ProfileMarkTileMetrics(val side: Dp, val radius: Dp) {
    /** 站标与砖边之间留出的托底：小尺寸 favicon 居中而不拉满，透明底与低分辨率都不难看。 */
    val inset: Dp get() = scaled(REFERENCE_INSET)
    val siteIconSide: Dp get() = side - inset * 2

    /** 与砖同心：外圆角减去托底。 */
    val siteIconRadius: Dp get() = radius - inset
    val globeGlyph: Dp get() = scaled(REFERENCE_GLOBE_GLYPH)
    val brandMarkSide: Dp get() = scaled(REFERENCE_BRAND_MARK)

    private fun scaled(reference: Dp): Dp = reference * (side / REFERENCE_SIDE)

    companion object {
        /** 配置详情头部：`64`，`Radius.panel`。 */
        val detailHeader = ProfileMarkTileMetrics(REFERENCE_SIDE, Theme.Radius.panel)
    }
}

/** 基准砖 `64` 上：托底 `12`（站标内嵌 `40`）、地球 `28`、品牌标 `36`。 */
private val REFERENCE_SIDE = 64.dp
private val REFERENCE_INSET = 12.dp
private val REFERENCE_GLOBE_GLYPH = 28.dp
private val REFERENCE_BRAND_MARK = 36.dp
