package cloud.oneoh.oneboxn.ui

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TopAppBarColors
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.Typography
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// 语义色令牌唯一出处：本文件之外禁止出现任何色值。
// 明暗取值经 M3 colorScheme 槽位下发；M3 无槽位的状态语义色（成功/警告）走 ExtendedTones。
// iOS 对等物 App/UI/Theme.swift（enum Theme）。
//
// 写法本身是 `make check rule=theme-palette` 的解析面：Android 腿认
// `private val <Name><Light|Dark> = Color(0xFF……)`、`<Name>Tone<Theme> = Tone(...)`、
// `ExtendedTones(...)` 的内联项与 `ChartSeries(download = …, upload = …)`。
// 换写法会让该端解析出零个颜色（门禁报「解析为空」而非静默放行）。

private val BackgroundLight = Color(0xFFF7F7F7)
private val BackgroundDark = Color(0xFF000000)
private val SurfaceLight = Color(0xFFFFFFFF)
private val SurfaceDark = Color(0xFF1C1C1E)
private val FillLight = Color(0xFFEFEFF0)
private val FillDark = Color(0xFF323236)

// 浮在 `fill` 之上的控件面（分段控件的滑块）。**两个主题都必须比 `fill` 亮**——
// 暗色 surface 是 #1C1C1E、fill 是 #323236，滑块用 surface 会比轨更暗，选中段反而陷下去。
// 明亮态它与 surface 同为 #FFFFFF 是巧合，不是可以换回 surface 的理由。
private val ControlRaisedLight = Color(0xFFFFFFFF)
private val ControlRaisedDark = Color(0xFF58585F)

// 分段控件的轨：它既坐在弹层面板（surface）上，也直接坐在页底（background）上，
// 而 `fill` 压 background 只有 1.07，轨与页面融成一片（Apple `Theme.segmentTrack` 记着读数）。
private val SegmentTrackLight = Color(0xFFEAEAEC)
private val SegmentTrackDark = Color(0xFF323236)
private val AccentLight = Color(0xFF0062CC)
private val AccentDark = Color(0xFF0A84FF)
private val AccentContainerLight = Color(0xFFD6E6F7)
private val AccentContainerDark = Color(0xFF183554)

// 行图标的「网络 / 连接」族。取值与 `chartUpload` 逐位相同，**而那不构成同一个令牌**：
// 两个维恰好取同一个数，不蕴含它们是同一件事；图表序列色不出现在图表以外的任何控件上。
// **只用于图标，不用于文字**：暗色压 `surface` 只有 `3.36:1`，过非文本的 `3:1`、不过正文的 `4.5:1`。
private val IconConnectivityLight = Color(0xFF5856D6)
private val IconConnectivityDark = Color(0xFF5E5CE6)
private val TextPrimaryLight = Color(0xFF1C1C1E)
private val TextPrimaryDark = Color(0xFFFFFFFF)
private val TextSecondaryLight = Color(0xFF69696E)
private val TextSecondaryDark = Color(0xFFB7B7BF)

// 列表行的悬停 / 按下填充：压在 `surface` 上，是「行与行靠什么分开」的第三样东西
// （另两样是 52 的行高与 28 的图标列）——不是分隔线。
private val RowHoverLight = Color(0xFFFAFAFA)
private val RowHoverDark = Color(0xFF252527)
private val RowActiveLight = Color(0xFFF3F3F4)
private val RowActiveDark = Color(0xFF2E2E30)

// 实心主按钮上的内容色：亮色主题白字、暗色主题深字。
private val OnAccentLight = Color(0xFFFFFFFF)
private val OnAccentDark = Color(0xFF101317)

// 两档投影的颜色。卡片与页面同层、是平的，不投影；投影只留给浮在内容之上的东西。
//
// 滑块走 `dropShadow`，颜色就是屏上那一档：明亮 `0.06` → `0x0F`；暗色不投影（全透明）。
//
// 弹出面板走海拔投影：Android 在给定色之上还要乘一层自己的 spot 系数（约 `0.19`），故这里写的是
// **目标不透明度 ÷ 0.19** 之后的值，屏上落回目标那一档；算出来超过 1 的直接封顶不透明。
//   shadowPopup   明亮 0.16/0.19 = 0.84 → 0xD6；暗色 0.55/0.19 > 1 → 封顶
private val ShadowThumbLight = Color(0x0F0F172A)
private val ShadowThumbDark = Color.Transparent
private val ShadowPopupLight = Color(0xD60F172A)
private val ShadowPopupDark = Color(0xFF000000)

// 错误色同时喂 colorScheme 槽位与 ExtendedTones，色值只写这一次。
private val ErrorToneLight = Tone(fg = Color(0xFFC4342A), container = Color(0xFFFFEBEA))
private val ErrorToneDark = Tone(fg = Color(0xFFFF453A), container = Color(0xFF2E1F20))

/**
 * 基础语义色的按名取用口（`Theme.colors.<令牌>`）。
 *
 * **应用层一律读这里，不直接读 `MaterialTheme.colorScheme.*`**：M3 的槽位名说的是它在 Material
 * 体系里的角色，不是本仓的语义——`surfaceContainerHigh` 读不出「输入框与进度轨的填充」，
 * `onSurfaceVariant` 读不出「次要文字」。槽位映射仍然保留（M3 自己的组件要用），
 * 但那是本文件的内部实现，不是调用点该知道的事。
 */
@Immutable
data class AppColors(
    val background: Color,
    val surface: Color,
    val fill: Color,
    val controlRaised: Color,
    val segmentTrack: Color,
    val accent: Color,
    val accentContainer: Color,
    val onAccent: Color,

    /**
     * 行图标的「网络 / 连接」族。
     *
     * 只经 `SettingsIconFamily.Networking` 取用，**没有第二个通道**：调用点传的是**族**不是颜色，
     * 故「谁用了这支令牌」恒等于「谁传了 `Networking`」。
     *
     * **不用于文字**：暗色压 `surface` 只有 `3.36:1`。
     */
    val iconConnectivity: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val rowHover: Color,
    val rowActive: Color,
)

// 状态语义色对：前景 + 容器。状态必须同时配图标或文字，禁止只靠颜色。
@Immutable
data class Tone(val fg: Color, val container: Color)

@Immutable
data class ExtendedTones(val success: Tone, val warning: Tone, val error: Tone)

private val LightTones = ExtendedTones(
    success = Tone(fg = Color(0xFF1E7A34), container = Color(0xFFE7F8EB)),
    warning = Tone(fg = Color(0xFF8A6000), container = Color(0xFFFFF2E0)),
    error = ErrorToneLight,
)

private val DarkTones = ExtendedTones(
    success = Tone(fg = Color(0xFF30D158), container = Color(0xFF1F3927)),
    warning = Tone(fg = Color(0xFFFF9F0A), container = Color(0xFF40311B)),
    error = ErrorToneDark,
)

// 图表序列色：只用于在一块图内区分数据序列，不表达状态、不作品牌色。
// 与 ExtendedTones 分开建模——状态色有既定褒贬语义，拿来画上下行会读出并不存在的好坏。
@Immutable
data class ChartSeries(val download: Color, val upload: Color)

private val LightChartSeries = ChartSeries(
    download = AccentLight,
    upload = Color(0xFF5856D6),
)

private val DarkChartSeries = ChartSeries(
    download = AccentDark,
    upload = Color(0xFF5E5CE6),
)

// 首页电源砖的三层光学（全应用唯一更重的一份材质）。
// 它的渐变停靠点与内侧高光不属于语义色——语义色是**跨端语义**契约，而这几档是
// 单一控件的光学参数。仍放本文件：色值只许出现在这里。
@Immutable
data class HeroSurface(
    val gradient: List<Color>,
    val topHighlight: Color,
    val leftHighlight: Color,
    val bottomShade: Color,
    /** 砖外那一圈与砖同形、不偏移的柔光；已连接时让给砖下的蓝色光晕，自己取透明。 */
    val glow: Color,
)

@Immutable
data class HeroOptics(val idle: HeroSurface, val active: HeroSurface)

/** 两档投影各自的颜色。 */
@Immutable
data class ShadowTiers(val thumb: Color, val popup: Color)

/**
 * 页顶晕染在两个主题下的不透明度（色相恒为 `accent`，不另立色值，调色板不多出一格）。
 *
 * 暗色取得更浓：同样的不透明度压在黑底上读起来弱得多。亮色顾着次级文字——
 * `neutral` 顶端压 `textSecondary` 仍有 `4.54`；`accent` 顶端是 `4.28`，它只铺在已连接的首页，那一带是电源砖。
 */
@Immutable
data class PageTintOpacity(val neutral: Float, val accent: Float)

private val HeroIdleTopLight = Color(0xFFFFFFFF)
private val HeroIdleMidLight = Color(0xFFFAFAFC)
private val HeroIdleBottomLight = Color(0xFFF2F2F6)
private val HeroIdleTopDark = Color(0xFF2C2C2E)
private val HeroIdleMidDark = Color(0xFF232325)
private val HeroIdleBottomDark = Color(0xFF1C1C1E)
private val HeroActiveTopLight = Color(0xFF4DA3FF)
private val HeroActiveBottomLight = Color(0xFF00459B)
private val HeroActiveTopDark = Color(0xFF409CFF)
private val HeroActiveBottomDark = Color(0xFF0051D5)

// 未连接 / 连接中那一圈中性柔光：亮色 `#3C3C43` 的 `16%`、暗色 `#EBEBF5` 的 `7%`（写成 ARGB）。
private val HeroIdleGlowLight = Color(0x293C3C43)
private val HeroIdleGlowDark = Color(0x12EBEBF5)

private val LightHeroOptics = HeroOptics(
    idle = HeroSurface(
        gradient = listOf(HeroIdleTopLight, HeroIdleMidLight, HeroIdleBottomLight),
        topHighlight = Color(0xFAFFFFFF),
        leftHighlight = Color(0xA6FFFFFF),
        bottomShade = Color(0x143C3C43),
        glow = HeroIdleGlowLight,
    ),
    active = HeroSurface(
        gradient = listOf(HeroActiveTopLight, AccentLight, HeroActiveBottomLight),
        topHighlight = Color(0x6BFFFFFF),
        leftHighlight = Color(0x38FFFFFF),
        bottomShade = Color(0x26000000),
        glow = Color.Transparent,
    ),
)

private val DarkHeroOptics = HeroOptics(
    idle = HeroSurface(
        gradient = listOf(HeroIdleTopDark, HeroIdleMidDark, HeroIdleBottomDark),
        topHighlight = Color(0x0FFFFFFF),
        leftHighlight = Color(0x0AFFFFFF),
        bottomShade = Color(0x66000000),
        glow = HeroIdleGlowDark,
    ),
    active = HeroSurface(
        gradient = listOf(HeroActiveTopDark, AccentDark, HeroActiveBottomDark),
        topHighlight = Color(0x6BFFFFFF),
        leftHighlight = Color(0x38FFFFFF),
        bottomShade = Color(0x26000000),
        glow = Color.Transparent,
    ),
)

internal val LightAppColors = AppColors(
    background = BackgroundLight,
    surface = SurfaceLight,
    fill = FillLight,
    controlRaised = ControlRaisedLight,
    segmentTrack = SegmentTrackLight,
    accent = AccentLight,
    accentContainer = AccentContainerLight,
    onAccent = OnAccentLight,
    iconConnectivity = IconConnectivityLight,
    textPrimary = TextPrimaryLight,
    textSecondary = TextSecondaryLight,
    rowHover = RowHoverLight,
    rowActive = RowActiveLight,
)

internal val DarkAppColors = AppColors(
    background = BackgroundDark,
    surface = SurfaceDark,
    fill = FillDark,
    controlRaised = ControlRaisedDark,
    segmentTrack = SegmentTrackDark,
    accent = AccentDark,
    accentContainer = AccentContainerDark,
    onAccent = OnAccentDark,
    iconConnectivity = IconConnectivityDark,
    textPrimary = TextPrimaryDark,
    textSecondary = TextSecondaryDark,
    rowHover = RowHoverDark,
    rowActive = RowActiveDark,
)

private val LightShadowTiers = ShadowTiers(ShadowThumbLight, ShadowPopupLight)
private val DarkShadowTiers = ShadowTiers(ShadowThumbDark, ShadowPopupDark)

private val LightPageTint = PageTintOpacity(neutral = 0.08f, accent = 0.12f)
private val DarkPageTint = PageTintOpacity(neutral = 0.14f, accent = 0.18f)

private val LocalAppColors = staticCompositionLocalOf<AppColors> { error("AppTheme not applied") }
private val LocalHeroOptics = staticCompositionLocalOf<HeroOptics> { error("AppTheme not applied") }
private val LocalTones = staticCompositionLocalOf<ExtendedTones> { error("AppTheme not applied") }
private val LocalChartSeries = staticCompositionLocalOf<ChartSeries> { error("AppTheme not applied") }
private val LocalReduceMotion = staticCompositionLocalOf { false }
private val LocalShadowTiers = staticCompositionLocalOf<ShadowTiers> { error("AppTheme not applied") }
private val LocalPageTint = staticCompositionLocalOf<PageTintOpacity> { error("AppTheme not applied") }

object Theme {
    /** 基础语义色。应用层的颜色一律从这里取名字，不读 M3 槽位。 */
    val colors: AppColors
        @Composable @ReadOnlyComposable get() = LocalAppColors.current

    val tones: ExtendedTones
        @Composable @ReadOnlyComposable get() = LocalTones.current

    val chartSeries: ChartSeries
        @Composable @ReadOnlyComposable get() = LocalChartSeries.current

    /**
     * **次级文字随它坐的底升档**（正文门槛 `4.5:1`）。
     *
     * `textSecondary` 压 `accentContainer` **亮态只有 `4.30`**，不达正文门槛；暗态 `6.29` 达标。
     *
     * **判据是「底此刻是不是 `accentContainer`」，不是「聚不聚焦 / 选不选中」**：
     * 输入框错误态的底是 `errorContainer`（`textSecondary` 压它 `4.76` 达标）、
     * 未聚焦是 `fill`（`4.75` 达标）—— 拿「聚焦」当判据会在错误态下多升一档。
     *
     * **两端同名**（iOS `Theme.secondaryText(on:)` + `SecondaryTextSurface`）。
     * 收成一个函数是因为它有多个消费点：各处各自写 `if (…) textPrimary else textSecondary`
     * 时，只要有一处漏掉或写反，屏上就是「同一种次级文字，有的升了有的没升」。
     */
    fun secondaryText(on: SecondaryTextSurface, colors: AppColors): Color = when (on) {
        SecondaryTextSurface.Plain -> colors.textSecondary
        SecondaryTextSurface.AccentContainer -> colors.textPrimary
    }

    /**
     * 次操作压在 `accentContainer` 上的**正确配对**：前景取 `textPrimary`，**不是 `accent`**。
     *
     * `accent` 压 `accentContainer` 在暗色下只有 `3.27:1` / `3.44:1`，而正文门槛是 `4.5:1`。
     *
     * **两端同名**（iOS `Theme.secondaryActionOnAccent`）：收成一个名字，调用点就不再各自手写前景。
     */
    val secondaryActionOnAccent: Tone
        @Composable @ReadOnlyComposable get() =
            Tone(fg = colors.textPrimary, container = colors.accentContainer)

    /**
     * 次操作按钮的**默认色对**：`fill` 填充 + `textPrimary` 文字。
     *
     * **两端同名**（iOS `Theme.secondaryAction`）。收成一个名字是为了让
     * `SecondaryButton` 的 `tone` 参数有一个说得出名字的缺省 —— 那条参数存在是因为
     * 失败弹层的「复制详情」**写入成功后要切成功对**。
     *
     * **前景不用 `accent`**：暗色的 `accent` 压 `fill` 只有 `3.50:1`。
     */
    val secondaryAction: Tone
        @Composable @ReadOnlyComposable get() =
            Tone(fg = colors.textPrimary, container = colors.fill)

    val heroOptics: HeroOptics
        @Composable @ReadOnlyComposable get() = LocalHeroOptics.current

    /** 页顶晕染顶端那一抹：`accent` 按主题与档位取不透明度。 */
    @Composable
    @ReadOnlyComposable
    fun pageTintTop(tint: PageTint): Color {
        val opacity = LocalPageTint.current
        return colors.accent.copy(
            alpha = when (tint) {
                PageTint.Neutral -> opacity.neutral
                PageTint.Accent -> opacity.accent
            },
        )
    }

    // 系统「移除动画」无障碍偏好；开启时状态过渡即时切换，保留直接的颜色反馈。
    val reduceMotion: Boolean
        @Composable @ReadOnlyComposable get() = LocalReduceMotion.current

    /** 无障碍字号档的阈值。Android 没有 iOS 那样的离散档位判别式，阈值只能自己定——
     *  这里是它在代码里的唯一来源，任何屏都不许另写一个数。 */
    const val accessibilityFontScale = 1.5f

    /** 当前是否落在无障碍字号档。iOS 对等物是 `dynamicTypeSize.isAccessibilitySize`。 */
    val isAccessibilityFontScale: Boolean
        @Composable @ReadOnlyComposable get() =
            LocalDensity.current.fontScale >= accessibilityFontScale

    // 弹层内容与弹层下沿之间的呼吸量。
    // 叠在 ModalBottomSheet 自带的 contentWindowInsets 之上——那一层只让开系统条，
    // 不加这一档按钮仍会紧贴手势条。iOS 对等物是 App/UI/Theme.swift 的 sheetBottomInset。
    //
    // 从按钮文字量起，屏上读到的是这一档加 24——弱操作按钮的 48 触控框在文字下方本就占 24。
    val sheetBottomInset = 20.dp

    /**
     * 弹层内衬：带底色的圆角块（输入框、按钮、选项行、卡）到弹层左右边的距离。
     *
     * 不是面板内衬 `Spacing.panelInset`（`6`）：那一档靠同心式「内层 = 外层 − 内衬」成立，而弹层的
     * 顶角随屏幕圆角走、远大于 `18`，同心式不成立，照搬 `6` 会让块几乎贴着弹层边。取与首页页边距同一档。
     * 纯文本行（标题、说明）在它之外再内缩 `Spacing.textInset`，与块里的文字对齐。
     */
    val sheetInset = 20.dp

    /**
     * **内容最大可读宽度**：给内容区一个上限，而不是一路铺满。
     *
     * 取值依据：正文一行不超过约 40 个汉字（正文 `13`，每字约 `13.8`）⇒ 正文宽 ≈ `552`，
     * 加上卡内衬与页面边距合计约 `57` ⇒ **`600`**。
     *
     * **在手机上它是恒等的**（手机宽度小于 `600dp`，两层约束都不生效），
     * 只在平板 / 横屏 / 可折叠展开态上可观测。
     */
    val maxReadableWidth = 600.dp

    /*
     * 本端没有「禁用态透明度」令牌：整层压透明度达不到禁用态要的对比度
     * （`(a·L₁+0.05)/(a·L₂+0.05)` 随 a 下降必然趋近 1 ⇒ 要的是另一对颜色，不是另一个系数），
     * 而这样一个令牌的存在本身就会把人引向那条路。
     * 要表达禁用，走 `SettingsRow` / `MenuPanel` / `PrimaryButton` 那条颜色对。
     */

    // 圆角家族。
    object Radius {
        /** 协议徽章、状态药丸之外的小填充块、头像。 */
        val chip = 8.dp

        /** 输入框、下拉选项行、行内按钮、图标底盘。 */
        val control = 12.dp

        /** 分组卡、弹层面板、模态面板、下拉弹出面板。 */
        val card = 14.dp

        /** 大面板（关于弹层）、空态图标砖。 */
        val panel = 18.dp

        /** 首页电源砖在基准砖 `160` 上的圆角；砖按边长等比缩放时乘 `HeroGeometry.scale` 同比跟上。 */
        val hero = 44.dp

        /**
         * 分段控件与其滑块、开关、进度条与轨道、主按钮、dock、浮动胶囊。
         * 全圆角没有单一 dp 取值（随高度变），故这一档以形状而非 Dp 表达。
         */
        val pill: Shape = CircleShape
    }

    /** 间距阶梯：页面内一切留白只许取这六档。 */
    object Spacing {
        /** 图标与其文字、两行文字之间。 */
        val xs = 4.dp

        /** 紧凑控件内的间隙。 */
        val sm = 8.dp

        /** 行内元素间隔。 */
        val md = 12.dp

        /**
         * 页面水平边距、区段之间、**弹层内块与块之间**。
         * 「分组卡之间」不归这一档，走 `cardGap`。
         */
        val lg = 16.dp

        /** 大区块之间。 */
        val xl = 24.dp

        /**
         * **分组卡与分组卡之间** `20`，基础步长序列之外的具名例外。
         *
         * **别把它吸附回 `16` 或 `24`**：依据是 UI 参考实现（`settings.tsx` / `developer.tsx`
         * 都是 `mb-5` = `20`），不是取中间值。
         *
         * **它只管「卡→卡」这一种关系**：「列表 → 紧随其后的操作卡」是 `16`，
         * 「卡 → 紧随其后的脚注文字」走基础序列的 `24`。
         * 一列里混着两种关系时，**分成两层 `Column` 各表达各的**，不要挑一个折中值。
         *
         * 全仓别的 `20`（首页页边距、弹层底部内衬、按钮左右内衬等）是别的角色：
         * **两个维恰好取值相同不构成同一个令牌**，不要把它们「统一」进本令牌。
         */
        val cardGap = 20.dp

        /** 英雄区上下的呼吸量。 */
        val xxl = 32.dp

        /**
         * 面板内衬：同心式「内层 = 外层 − 内衬」的那个减数（圆角家族里只有 `18 − 6 = 12` 成立）。
         * `6` 是具名的派生例外，**不要把它吸附回 `sm`**。
         */
        val panelInset = 6.dp

        /**
         * 纯文本行在面板内衬之外再各自左右内缩，合计仍是 `16` 的读字边距。
         * 内衬只约束**带底色的块**——不要把标题也顶到离边 `6`。
         */
        val textInset = 10.dp
    }

    /**
     * 卡内行的骨架尺寸：
     * `28` 图标列 → 主标题 / 副标题 → 右侧 badge → 行尾指示符 `13`，最小高 `52`。
     *
     * **单一来源**：散在各文件里写时，「同一个角色两个值」只有逐文件读才看得出来。
     */
    object RowMetrics {
        /** 行最小高（命中区由它保证，不是把控件画到这么高）。 */
        val minHeight = 52.dp

        /** 左侧图标列宽：图标本身小于列宽，列宽负责让各行的主标题左缘对齐。 */
        val iconColumnWidth = 28.dp

        /** 左侧图标字形尺寸。 */
        val iconSize = 22.dp

        /** 行尾指示符（chevron_right / arrow_up_right / chevron_up_down）的字形尺寸。 */
        val trailingIconSize = 13.dp

        /**
         * 卡内行的**纵向**内衬（横向走 `Spacing.lg`），管全部卡内主干行；
         * 参考实现的卡内主干行一律是 `12`。
         */
        val verticalPadding = 12.dp
    }

    /** 字号阶梯：字号 + 字距 + 基准字重同处一格，调用点不再散落魔法数。 */
    object Type {
        /**
         * 页面大标题、**关于弹层的应用名**、**用量摘要的主数字**、**内存卡的读数**
         * （`22/600`，-0.02em）。后三个不是「页面标题」——
         * 它们共用这一档的理由是「**全页最强的那一个**」，而不是「它是标题」。
         */
        val pageTitle = TextStyle(
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.02).em,
        )

        /**
         * 空态标题、**导入流程的状态标题**、**扫码页三个权限态的标题**（`17/600`，-0.01em）。
         *
         * 后两类**不是空态** —— 它们是「整屏只讲一件事」的那一类屏的标题。
         */
        val emptyTitle = TextStyle(
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.01).em,
        )

        /**
         * 弹层标题 16/600，-0.01em：失败弹层 · 帮助弹层 · 导入弹层 · 规则编排器 ·
         * 引擎参数编辑器 · 更新记录详情。
         *
         * `ConfigScreen.MergedBody` 的「合并失败」也借了本档，但它是**页内失败态的标题**，不是弹层标题。
         */
        val sheetTitle = TextStyle(
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.01).em,
        )

        // 注释里**不要让 `/` 紧挨 `**`**：Kotlin 的块注释**可以嵌套**，`/**` 会开一个内层注释，
        // 而一个 `*/` 只关得掉内层 ⇒ **其后整份文件都成注释**。
        /** 列表行主标题、操作行标签、**读数值（NAT / 测速 / 用量 / 运行统计）**、
         *  **弹层的紧凑标题条**（`44` 高、居中、带关闭键） `15` / **400–600**，-0.005em。 */
        val rowTitle = TextStyle(
            fontSize = 15.sp,
            fontWeight = FontWeight.Normal,
            letterSpacing = (-0.005).em,
        )

        /**
         * `14` / **400–600**，-0.005em。
         *
         * 角色（**字重各自在调用点补，本档只给字号**）：
         * 下拉触发文本（`500`）· **下拉选项行主文本（`400`，见 `MenuPanel`）** ·
         * 三种按钮标签（主 `600` / 次 `500` / 安静 `400`）· **输入行与搜索行的文本** ·
         * 配置行标题 · 日志页与详情页的行文本。
         */
        val control = TextStyle(
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-0.005).em,
        )

        /** **带强调的控件与标记**、分段控件、徽章、**帮助弹层的说明块标题**、
         *  **值行的当前值**、**空态说明**、**三颗胶囊的文字**（跟随 / 回到顶部 / 隧道状态）、
         *  **首页入口卡的说明** `13` / **400–600**，-0.01em。
         *
         *  **角色不是「状态文案」**：照那个名字选档，会把 `textSecondary` 的从属说明选到这一档来。 */
        val status = TextStyle(
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-0.01).em,
        )

        /**
         * 首页电源砖下的状态行 `17/600`，-0.01em：压在大砖下面，`13` 那一档撑不起「连没连上」这一层级。
         * 与 `emptyTitle` 取值相同而角色不同，不合成一档。
         */
        val heroStatus = TextStyle(
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.01).em,
        )

        /**
         * `12/400`：
         *
         * ```
         * 行副标题与说明句   开发者页开关的说明 · 规则页说明 · 帮助弹层说明块正文 ·
         *                    引擎参数风险块 · 运行统计的停滞提示
         * 输入行三段文字     标签 · 错误 · 辅助说明
         * 技术值副文本       UA 行的 `technicalCaption` · 导入页 URL · 合并详情 · 导入失败详情 ·
         *                    失败弹层的错误标识与详情 · 规则预览首行   ⇒ **一律在调用点加等宽**
         * 失败文案与阶段行   NAT 类型 / 网络测速各两处（失败文案 + `PhaseLine`）
         * 速率读数           会话卡速率 · 运行统计速率            ⇒ **在调用点加 `tabular()`**
         * 用量摘要           导入页的剩余 / 无用量 / 每项的标签与值
         * 规则编排器         两个字段标签 · 校验计数两条 · 预览标签与 `+N` 计数
         * ```
         *
         * **本档只给字号与字重，字族在调用点加**：同一个档同时服务比例文字与要逐字比对的技术值，
         * 别把等宽写进档里。
         */
        val subtitle = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Normal)

        /**
         * `11/500`：
         *
         * ```
         * 页脚               设置页版本页脚（`tabular()`）
         * 列表行的元信息     配置行第三行 · 配置页两条 `MetaLine` · 规则行的值（等宽）
         * 日志行三段         级别（等宽）· 时刻（`tabular()`）· 正文（等宽）
         * 表格式读数行       引擎信息 · 开发者页值行 · NAT 类型与测速的读数行 ·
         *                    失败弹层的 `MetaRow` · 更新记录行三段
         * 脚注               空态脚注 · 会话卡读数格的小标题
         *                    （散文提示句不在本档，走 `note`）
         * 延迟读数           节点弹层行（`tabular()`）
         * 配置正文           行号（`tabular()`）与正文（等宽）
         * 图表               用量图的刻度（`tabular()`）与摘要标签
         * 等宽技术值         关于弹层的 `MonospaceValue` · 导航行的 `NavValue.Technical`
         * 下拉选项行的副标题 等宽数字
         * 其余               运行统计卡的窗口与峰值 · 测速运行头的端点 · 规则编排器的优先级标签
         * ```
         *
         * 「下拉选项行的副标题」要单看：它的**角色名叫「副标题」，档却是本档 `11`**，
         * 不是 `subtitle`（`12`）——照角色名选档会选错一档。
         *
         * 本档同样只给字号与字重，等宽与 `tabular()` 都在调用点加。
         */
        val meta = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium)

        /**
         * `11/400`。**散文说明脚注** —— `11` 档三个角色里的第三个
         * （区段小标题 `600` · 元信息 `500` · **说明脚注 `400`**）。
         * 同字号同色只差一档字重，借 `meta` 会静默粗一档。
         *
         * 另一端的对位物：Apple `Theme.TypeScale.note`。
         *
         * **行高不在本档里**：只有规则页的生效说明要 `字号 × 1.375`，**那一处在调用点加**
         * （与 Apple 同形：它的 `noteLineHeightMultiple` 也放在 `RulesScreen.swift`）。
         */
        val note = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Normal)

        /**
         * 等宽文本的**行高倍数**，**按角色分档**。
         *
         * **两个值不同不是不一致，是两个角色**：参考实现自己就给了这两块不同的行高，
         * 不写角色的话，下一个人会拿其中一个去「统一」另一个。
         *
         * 用倍数而不是「自然行高 + 固定行距」：自然行高取决于字体度量，两端会算出两个数。
         *
         * **放在这里而不是调用点**：调用点写一个 `.sp` 会被 `android-font-source` 当成档外字号拦下，
         * 且倍数本身是跨端的数，不该散在屏文件里。
         */
        enum class MonoLeading(val multiplier: Float) {
            /** **文本块**角色：配置正文，行高 = 字号 × `1.625`。 */
            Block(1.625f),

            /** **列表行**角色：日志行，行高 = 字号 × `1.55`。 */
            Row(1.55f),
        }

        /**
         * 区段小标题：11/600 大写，字距 **0.04em**。
         *
         * 依据是**角色**：参考里这一族有两种配对——**全大写 + 紧字距 `0.04em`** 与
         * **Title Case + 宽字距 `0.08em`**（首页）。两个属性同时不同 ⇒ 两种角色；
         * 本档是全大写 ⇒ 取前者，不要把两种角色各取一半拼成第三种。
         *
         * 消费方不只共享件 `SectionHeader`：运行统计页卡内的区段标题（内存 / 速率 / 窗口 / 连接）
         * 直接用本档，改 `SectionHeader` 不等于改完了。
         */
        val sectionLabel = TextStyle(
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.04.em,
        )

        /** dock 标签、参数「默认」徽章、配置行状态药丸、规则编辑器的动作与匹配徽章 `10/600`。 */
        val badge = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.SemiBold)

        /**
         * 会话卡延迟圆位里的毫秒数 `15/700`，-0.02em。四位数降两号到 [latencyDigitsCompact]：
         * 按原字号排会顶到圆位边缘。无读数时的「—」取同字号的 `600`。
         */
        val latencyDigits = TextStyle(
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.02).em,
        )
        val latencyDigitsCompact = latencyDigits.copy(fontSize = 13.sp)

        /** 圆位里毫秒数下方的「ms」`9/600`：只是单位，比页脚那一档还小一号。 */
        val latencyUnit = TextStyle(fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
    }
}


/**
 * 次级文字坐在哪种底上（[Theme.secondaryText]）。
 *
 * **只有两档**：加一档就要同时回答「那个底上的次级文字该是什么色」，
 * 而文字只有两级（`textPrimary` / `textSecondary`），不加第三档。
 */
enum class SecondaryTextSurface {
    /** 页面底、卡面、`fill`、`errorContainer` —— 这些底上 `textSecondary` 都达标。 */
    Plain,

    /** `accentContainer`（激活行 / 选中项 / 聚焦输入框）。 */
    AccentContainer,
}

/**
 * 分段控件的滑块：极轻的下投影（CSS `0 1px 1px`）。模糊不大于下移 ⇒ 只落在下沿、不越过上沿，
 * 不在四周成晕。
 *
 * 暗色不投影：压在深色轨上的黑影读成滑块四周一圈晕；暗色的层级只靠 `controlRaised` 压 `segmentTrack` 的填充差。
 * 不走海拔投影：海拔投影自带四周一圈环境光阴影，定不出「只在下沿」。
 */
@Composable
fun Modifier.shadowThumb(shape: Shape): Modifier =
    dropShadow(shape, Shadow(radius = 1.dp, color = LocalShadowTiers.current.thumb, offset = DpOffset(0.dp, 1.dp)))

/** 下拉弹出面板：浮在内容之上的材质层，保留投影。 */
@Composable
fun Modifier.shadowPopup(shape: Shape): Modifier = shadowTier(shape, SHADOW_POPUP_ELEVATION) { it.popup }

@Composable
private fun Modifier.shadowTier(shape: Shape, elevation: Dp, pick: (ShadowTiers) -> Color): Modifier {
    val color = pick(LocalShadowTiers.current)
    return shadow(elevation = elevation, shape = shape, ambientColor = color, spotColor = color)
}

// 海拔由模糊半径换算（Android 的 elevation 不是模糊半径本身，约 1:3）。
private val SHADOW_POPUP_ELEVATION = 16.dp

/**
 * 页顶晕染：页面顶上一抹冷色，向下融进页面底色。取哪一档由调用方给，除已连接的首页外都是 [Neutral]。
 *
 * 卡片是平的，卡与页的填充差只有 `1.07` / `1.23`；页面的层次由这一抹补上。
 */
enum class PageTint {
    /** 各页的常态。 */
    Neutral,

    /** 已连接的首页：浓一档，接住电源砖的蓝色光晕。 */
    Accent,
}

/** 晕染在页面整高的这一比例处完全融进底色。 */
private const val PAGE_TINT_FADE_EXTENT = 0.44f

/**
 * 页面根背景：页面底色 + 页顶晕染，各屏根部挂一次，状态栏那一带也由它铺满。
 *
 * 档位切换走电源砖底色那一档时长：页面与砖同一拍变色。
 */
@Composable
fun Modifier.screenBackground(tint: PageTint = PageTint.Neutral): Modifier {
    val base = Theme.colors.background
    val top by animateColorAsState(Theme.pageTintTop(tint), motionSpec(Motion.HERO_FILL_MS), label = "pageTint")
    return drawBehind {
        drawRect(base)
        // 终点取同一色的零不透明度：一路只有透明度在变，色相不随插值漂移。
        drawRect(
            Brush.verticalGradient(
                0f to top,
                PAGE_TINT_FADE_EXTENT to top.copy(alpha = 0f),
                startY = 0f,
                endY = size.height,
            ),
        )
    }
}

/**
 * 顶栏取透明，露出同一张页底：页顶有晕染，涂成纯色会在顶栏下沿切出一道接缝。
 * 内容不会滚进顶栏底下（`Scaffold` 把内容排在顶栏之下），故透明不会让正文压到标题上。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun pageTopBarColors(): TopAppBarColors = TopAppBarDefaults.topAppBarColors(
    containerColor = Color.Transparent,
    scrolledContainerColor = Color.Transparent,
)

// 语义色 → M3 槽位映射：
//   background←background（分组色，页面根）；surface 与 surfaceVariant、surfaceContainer(≤中)←surface（卡片）；
//   surfaceContainerHigh(est)←fill；primary←accent；primary/secondaryContainer←accentContainer；
//   onSurfaceVariant←textSecondary；error 族←错误 Tone。surfaceTint 设为 surface 以中和海拔染色。
//
// 明亮态纯白是卡片，根背景是分组灰（不是纯白）。
private val LightColors = lightColorScheme(
    primary = AccentLight,
    onPrimary = OnAccentLight,
    primaryContainer = AccentContainerLight,
    onPrimaryContainer = TextPrimaryLight,
    secondary = AccentLight,
    onSecondary = OnAccentLight,
    secondaryContainer = AccentContainerLight,
    onSecondaryContainer = TextPrimaryLight,
    background = BackgroundLight,
    onBackground = TextPrimaryLight,
    surface = SurfaceLight,
    onSurface = TextPrimaryLight,
    surfaceVariant = SurfaceLight,
    onSurfaceVariant = TextSecondaryLight,
    surfaceContainerLowest = SurfaceLight,
    surfaceContainerLow = SurfaceLight,
    surfaceContainer = SurfaceLight,
    surfaceContainerHigh = FillLight,
    surfaceContainerHighest = FillLight,
    surfaceTint = SurfaceLight,
    error = ErrorToneLight.fg,
    onError = OnAccentLight,
    errorContainer = ErrorToneLight.container,
    onErrorContainer = ErrorToneLight.fg,
)

private val DarkColors = darkColorScheme(
    primary = AccentDark,
    onPrimary = OnAccentDark,
    primaryContainer = AccentContainerDark,
    onPrimaryContainer = TextPrimaryDark,
    secondary = AccentDark,
    onSecondary = OnAccentDark,
    secondaryContainer = AccentContainerDark,
    onSecondaryContainer = TextPrimaryDark,
    background = BackgroundDark,
    onBackground = TextPrimaryDark,
    surface = SurfaceDark,
    onSurface = TextPrimaryDark,
    surfaceVariant = SurfaceDark,
    onSurfaceVariant = TextSecondaryDark,
    surfaceContainerLowest = SurfaceDark,
    surfaceContainerLow = SurfaceDark,
    surfaceContainer = SurfaceDark,
    surfaceContainerHigh = FillDark,
    surfaceContainerHighest = FillDark,
    surfaceTint = SurfaceDark,
    error = ErrorToneDark.fg,
    onError = OnAccentDark,
    errorContainer = ErrorToneDark.container,
    onErrorContainer = ErrorToneDark.fg,
)

// M3 的字阶槽位：不写 `style` 的 `Text(` 与 M3 自己的组件落在这里，而不是 `Theme.Type`。
//
// 只映射 `labelLarge`（按钮文案：顶栏文字动作 + `AlertDialog` 的动作键），它就是 `control` 档的
// 按钮角色。顶栏内联标题（`titleLarge`）与 `AlertDialog` 的标题 / 正文（`headlineSmall` /
// `bodyMedium`）没有对应的字阶角色，不映射、也不发明，仍落 M3 默认。
//
// 只 `copy` 字号 / 字重 / 字距三维，不覆盖行高：`Theme.Type.control` 不带 `lineHeight`，
// 而 M3 的 `labelLarge` 带 `20.sp`，整条替换会把行高一起换掉；行高留给 M3。
private val AppTypography = Typography().let { m3 ->
    m3.copy(
        labelLarge = m3.labelLarge.copy(
            fontSize = Theme.Type.control.fontSize,
            fontWeight = Theme.Type.control.fontWeight,
            letterSpacing = Theme.Type.control.letterSpacing,
        ),
    )
}

// M3 形状与圆角家族同源。
private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(Theme.Radius.chip),
    small = RoundedCornerShape(Theme.Radius.control),
    medium = RoundedCornerShape(Theme.Radius.card),
    large = RoundedCornerShape(Theme.Radius.panel),
    extraLarge = RoundedCornerShape(Theme.Radius.panel),
)

/** 主缓动：两端唯一曲线，一切时长都配它。 */
val MainEasing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)

/** 动效时长表的唯一出处。 */
object Motion {
    const val HERO_FILL_MS = 280
    const val HERO_PRESS_MS = 140
    const val GLOW_MS = 400
    const val MENU_MS = 160
    const val PROGRESS_MS = 400
    const val ROW_MS = 120
    const val COLOR_MS = 150
    const val HEALTH_MS = 300
    const val PULSE_MS = 1_800

    /**
     * **滚动胶囊的出现 / 消失**：日志跟随胶囊与配置页回到顶部胶囊同源。
     *
     * **不复用 [COLOR_MS]（`150`）**：那是「行悬停 / 通用颜色过渡」，
     * 而这两颗胶囊是**元素的出现与消失**，不是颜色过渡。
     * **也不复用同为整百的 [HEALTH_MS] / [PAGE_MS]**：值不同，角色更不同。
     */
    const val PILL_MS = 200

    /**
     * **切根**：页面切换（透明度 + `5` 上移），三个 tab 根之间那一次。
     *
     * **不复用同为 `300` 的 [HEALTH_MS]**：值相等而角色不同，
     * 共用一个名字时，只改其中一档会让另一档静静跟着错。
     *
     * 只管切根：设置栈的子路由进出不走这一档。
     */
    const val PAGE_MS = 300
}

/**
 * 状态过渡动画的唯一入口（镜像 iOS stateTransition）。
 * 减少动态效果时退化为 snap——去掉位移与缩放，保留直接的颜色反馈。
 */
@Composable
fun <T> motionSpec(durationMillis: Int): FiniteAnimationSpec<T> =
    if (LocalReduceMotion.current) snap() else tween(durationMillis, easing = MainEasing)

@Composable
fun <T> stateTransitionSpec(): FiniteAnimationSpec<T> = motionSpec(Motion.COLOR_MS)

/**
 * **内容区的最大可读宽度 + 居中**（`Theme.maxReadableWidth`）。
 *
 * ```
 * fillMaxWidth()                     先吃满可用宽
 * wrapContentWidth(CenterHorizontally) 放松下限并把子件顶到居中 —— 只写下一行，内容会贴着起始边
 * widthIn(max = maxReadableWidth)    再把子件收到上限
 * ```
 *
 * **挂在页面横向内衬之外**：那个 `600` 是「正文 `552` + 卡内衬与页边距约 `57`」推出来的，
 * **含页边距** ⇒ 顺序上它必须在 `.padding(horizontal = …)` **之前**。
 *
 * **只管内容区，不管顶栏**：顶栏是窗口装饰，宽屏上它照旧通栏 ——
 * 与 Apple 侧把它挂在 `pageInsets`（而不是窗口）同一个道理。
 *
 * 窄于 `600` 时三层全是恒等 ⇒ 手机零改动，只有平板 / 横屏会变。
 */
fun Modifier.readableContentWidth(): Modifier = this
    .fillMaxWidth()
    .wrapContentWidth(Alignment.CenterHorizontally)
    .widthIn(max = Theme.maxReadableWidth)

// 等宽数字：数值频繁变化的文本用 tabular figures，避免跳动（iOS monospacedDigit 对等）。
fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

// 等宽文本的行高。**从本档自己的字号算**，不写死一个 sp——换档时行高跟着走，而写死的那个数不会。
//
// **角色由调用点给**（`MonoLeading.Block` / `.Row`）：两个角色两个倍数，
// 而它们在参考实现里本来就是两个数。**不给默认值**——挑哪一档是调用点必须说清的事。
//
// **`lineHeight` 单独设是没有效果的**：Compose 的默认 `LineHeightStyle` 会把首行上方与
// 末行下方的额外行距**裁掉**，而这两处每个逻辑行都是**单行** ⇒ 加上去的那一截被两头各裁一半，
// 盒子高度不动。⇒ 必须同时把 `trim` 关掉。
fun TextStyle.monoLeading(role: Theme.Type.MonoLeading): TextStyle = copy(
    lineHeight = fontSize * role.multiplier,
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.None,
    ),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    // 系统偏好不可得时 isSystemInDarkTheme() 返回 false，即回退明亮主题。
    val dark = isSystemInDarkTheme()
    CompositionLocalProvider(
        LocalTones provides if (dark) DarkTones else LightTones,
        LocalChartSeries provides if (dark) DarkChartSeries else LightChartSeries,
        LocalHeroOptics provides if (dark) DarkHeroOptics else LightHeroOptics,
        LocalAppColors provides if (dark) DarkAppColors else LightAppColors,
        LocalShadowTiers provides if (dark) DarkShadowTiers else LightShadowTiers,
        LocalPageTint provides if (dark) DarkPageTint else LightPageTint,
        LocalReduceMotion provides rememberReduceMotion(),
    ) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            shapes = AppShapes,
            typography = AppTypography,
            content = content,
        )
    }
}

@Composable
private fun rememberReduceMotion(): Boolean {
    val context = LocalContext.current
    var reduce by remember { mutableStateOf(readReduceMotion(context)) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reduce = readReduceMotion(context)
            }
        }
        context.contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer,
        )
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    return reduce
}

// 系统「移除动画」开关落点：动画时长缩放为 0 即视为减少动态。
private fun readReduceMotion(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
