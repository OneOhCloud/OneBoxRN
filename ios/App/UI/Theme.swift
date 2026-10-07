import SwiftUI
import UIKit

// 语义色令牌唯一出处：本文件之外禁止出现任何色值。
// 动态色经平台的 trait / appearance 分支实现；系统偏好不可得（unspecified / 非明暗外观）时
// 落入亮色分支，满足「主题跟随系统，无法取得时回退明亮」。
//
// **写法受门禁约束**：`make check rule=theme-palette` 按 `static let <名> = dyn(0x…, 0x…)`、
// `static let <名> = Tone(fg: dyn(…), container: dyn(…))` 与别名 `static let <名> = <名>` 三种
// 形态逐端解析。换一种写法会让 Apple 端解析出零个颜色——那时报的是「解析为空」，不是静默放行。
enum Theme {
    // —— 基础语义色 ——
    // 页面根背景是分组色，卡片才是最亮/最深的一层。卡片是平的：不描边、不投影、不画渐变。
    // 卡与页的填充差只有 1.07 / 1.23，页面的层次另由页顶晕染（`PageTint`）补上。
    static let background = dyn(0xF7F7F7, 0x000000)
    static let surface = dyn(0xFFFFFF, 0x1C1C1E)
    static let fill = dyn(0xEFEFF0, 0x323236)
    /// 浮在分段轨（`segmentTrack`）之上的控件面（分段控件的滑块）。
    ///
    /// **它必须比轨亮，两个主题都是**——这是它存在的唯一理由。明亮态它恰好等于
    /// `surface`（`#FFFFFF`），暗色却不能用 `surface`：
    /// 暗色的 `surface`（`#1C1C1E`）比轨（`#323236`）**更暗**，选中的滑块反而陷下去。
    static let controlRaised = dyn(0xFFFFFF, 0x58585F)
    /// 分段控件的轨。
    ///
    /// **不取 `fill`**：分段控件既坐在弹层面板（`surface`）上，也直接坐在页底（`background`）上，
    /// 而 `fill` 压 `background` 只有 `1.07`，轨与页面融成一片。本档压 `background` `1.12`、
    /// 压 `surface` `1.20`，两处都读得出一条轨；再深一档，未选中段的 `textSecondary` 就掉到 `4.5` 以下
    /// （本档上是 `4.54`）。暗色页底是纯黑，`fill` 压上去本就清楚，故暗色同 `fill`。
    static let segmentTrack = dyn(0xEAEAEC, 0x323236)
    static let accent = dyn(0x0062CC, 0x0A84FF)
    static let accentContainer = dyn(0xD6E6F7, 0x183554)
    static let textPrimary = dyn(0x1C1C1E, 0xFFFFFF)
    static let textSecondary = dyn(0x69696E, 0xB7B7BF)
    /// 实心主按钮上的内容色：亮色主题白字、暗色主题深字。
    static let onAccent = dyn(0xFFFFFF, 0x000000)

    /// 状态语义色对：前景 + 容器。状态必须同时配图标或文字，禁止只靠颜色。
    struct Tone {
        let fg: Color
        let container: Color
    }

    static let success = Tone(fg: dyn(0x1E7A34, 0x30D158), container: dyn(0xE7F8EB, 0x1F3927))
    static let warning = Tone(fg: dyn(0x8A6000, 0xFF9F0A), container: dyn(0xFFF2E0, 0x40311B))
    static let error = Tone(fg: dyn(0xC4342A, 0xFF453A), container: dyn(0xFFEBEA, 0x2E1F20))

    /// 图表序列色：只用于在一块图内区分数据序列，不表达状态、不作品牌色。
    /// 与状态色分开——那三个色有既定褒贬语义，拿来画上下行会读出并不存在的好坏。
    /// 下行取 accent 同值（它是主序列），上行取 systemIndigo（与 accent 拉开约 65° 色相）。
    static let chartDownload = accent
    static let chartUpload = dyn(0x5856D6, 0x5E5CE6)

    /// 行图标的**「网络 / 连接」族**：路由模式 · 区域。**只用于图标，不用于文字。**
    ///
    /// **它与 `chartUpload` 取值相同而角色无关，不要合并成一个令牌**：图表序列色不出现在图表以外的
    /// 任何控件上。改其中一个时**不要顺手改另一个**。
    static let iconConnectivity = dyn(0x5856D6, 0x5E5CE6)

    /// 行的悬停 / 按下填充：分组卡内的行靠填充分开，不靠线。压在 `surface` 上。
    static let rowHover = dyn(0xFAFAFA, 0x252527)
    static let rowActive = dyn(0xF3F3F4, 0x2E2E30)

    /// 次操作的两个色对（柔和填充，禁描边）：
    /// 卡内/内容上的次按钮落 `fill` 底，需要从强调面里浮起时落 `accentContainer` 底。
    ///
    /// **两处的前景都不是 `accent`**：暗色的 `accent` 压 `fill` 只有 `3.50:1`，
    /// `accent` 压 `accentContainer` 只有 `3.27:1`——两对都达不到普通字号的
    /// `4.5:1`。层级改由填充承担，文字一律 `textPrimary`。
    static let secondaryAction = Tone(fg: textPrimary, container: fill)
    static let secondaryActionOnAccent = Tone(fg: textPrimary, container: accentContainer)

    /// 次级文字坐在哪个面上。**入参是「面」，不是一个 `Bool`**：
    /// 布尔标志会让调用点读成「要不要特殊处理」，而这里要说的是「我压在什么上面」。
    enum SecondaryTextSurface {
        /// 卡面 / `fill` / 错误容器 —— 这三种上面 `textSecondary` 都达标（`5.46` / `4.75` / `4.76`）。
        case plain
        /// `accentContainer`（激活行、下拉选中行、输入框聚焦态）。
        case accentContainer
    }

    /// 次级文字的颜色。**压在 `accentContainer` 上时要升到 `textPrimary`**：
    /// `textSecondary` 压 `accentContainer` 亮色只有 `4.30`，不到正文 `4.5`（暗色 `6.29` 达标）。
    ///
    /// 单点决定之后，调用点只需回答「我坐在什么上面」。
    static func secondaryText(on surface: SecondaryTextSurface) -> Color {
        switch surface {
        case .plain: return textSecondary
        case .accentContainer: return textPrimary
        }
    }

    /// 弹层内容与弹层下沿之间的呼吸量。
    ///
    /// 必须显式给这一档、不能靠平台兜底：只让开 home indicator 时按钮仍会紧贴指示条。Android 侧同名令牌在 `ui/Theme.kt`。
    ///
    /// **从按钮文字量起，屏上读到的是这一档加 24**——文字按钮的 48 触控框本身在文字下方占 24。
    static let sheetBottomInset: CGFloat = 20

    /// 圆角家族。嵌套容器保持同心圆角：**内层圆角 = 外层圆角 − 内衬**
    /// （不是「小于」——小于会让内外曲率不同心，视觉上内层像是被塞进去的）。
    enum Radius {
        /// 协议徽章、小填充块。
        static let chip: CGFloat = 8
        /// 输入框、下拉选项行、行内按钮、图标底盘。
        static let control: CGFloat = 12
        /// 分组卡、弹层面板、模态面板、下拉弹出面板。
        static let card: CGFloat = 14
        /// 大面板（关于页 logo）、空态图标砖。
        static let panel: CGFloat = 18
        /// 首页电源砖在基准砖 `160` 上的圆角；砖按边长等比缩放时，调用点乘 `HeroGeometry.scale`
        /// 同比跟上——圆角不跟，砖放大后就读起来变方。
        static let hero: CGFloat = 44
        /// 全圆。优先用 `Capsule()` 表达；只有必须给 `RoundedRectangle` 一个数值时才取这一档
        /// （足够大，任何本仓控件的高度折半都不及它，故渲染结果与 Capsule 一致）。
        static let pill: CGFloat = 999
        /// **卡内内缩的状态层**（悬停 / 按下的那层底）的圆角：
        /// 同心式取 `card 14 − 内衬 8`。它不是嵌套块，故不把外层卡升成 `panel`。
        ///
        /// **只给左右没贴到卡沿的那一类行。** 贴沿的行（设置卡里 `339` 宽 = 卡宽的行）不取这一档：
        /// 它的左右沿就是卡沿，给它圆角只会在卡沿上啃出两个豁口。
        /// 判准是**这层底露不露出它下面的卡**，不是「哪个 ButtonStyle」，也不是「可不可点」。
        static let stateLayer: CGFloat = 6
    }

    /// **内容最大可读宽度**：窗口再宽只加两侧留白，不把一行字拉长。
    ///
    /// 取「一行不超过约 40 个汉字」为判准：每字约 `13.8`（正文 `13`，汉字近似一个字宽）
    /// ⇒ 正文宽 ≈ `552`，加上卡内衬与页面边距合计约 `57` ⇒ **`600`**。
    /// `TARGETED_DEVICE_FAMILY` 含 iPad，宽屏上页面版式靠它收住行长。
    static let maxReadableWidth: CGFloat = 600

    /// 间距阶梯：`4 / 8 / 12 / 16 / 24 / 32`。各屏一律读它，不散落魔法数。
    enum Spacing {
        /// 行内细缝：图标与其贴身标签、主标题与元信息。
        static let extraSmall: CGFloat = 4
        /// 紧凑行内间隔、区段小标题与其下首个容器（`6` 由 `small` 减半不成立时就地给）。
        static let small: CGFloat = 8
        /// 行内元素间隔。
        static let medium: CGFloat = 12
        /// 页面水平边距（两端与全部页面恒为此值）、分组卡之间、标题与首个内容组之间。
        static let large: CGFloat = 16
        /// 英雄区与其下内容区、区块之间的大节奏。
        static let extraLarge: CGFloat = 24
        /// 版式分区之间的最大留白。
        static let huge: CGFloat = 32
    }

    /// 字号阶梯。字重只用 `400 / 500 / 600`（regular / medium / semibold）。
    ///
    /// **名字是 `TypeScale` 而不是 `Type`**：Swift 里 `Theme.Type` 是元类型语法，
    /// 编译器直接拒绝把嵌套类型命名为 `Type`（"would conflict with the 'foo.Type' expression"）。
    ///
    /// 给确切磅值而不是 `.body` / `.caption` 这类语义字阶：两端逐档对齐。
    /// **每一档都带一个 `relativeTo`**，故它们随动态字号缩放——`Font.system(size:)` 本身是定值字体，
    /// 不随动态字号变。`relativeTo` 取与该字号最近的系统文本样式：它只决定**按哪一档的曲线缩放**，
    /// 默认字号下渲染结果不变。
    enum TypeScale {
        /// 页面大标题（`22/600`，字距 `-0.02em`）。
        static let pageTitle = TypeStyle(size: 22, trackingEm: -0.02, weight: .semibold, relativeTo: .title2)
        /// 空态标题（`17/600`，字距 `-0.01em`）。
        static let emptyTitle = TypeStyle(size: 17, trackingEm: -0.01, weight: .semibold, relativeTo: .body)
        /// 弹层标题（`16/600`，字距 `-0.01em`）。
        static let sheetTitle = TypeStyle(size: 16, trackingEm: -0.01, weight: .semibold, relativeTo: .callout)
        /// 列表行主标题、操作行标签（`15/400`，字距 `-0.005em`）。
        ///
        /// 弹层的紧凑标题条（`15/600`）没有令牌，在调用点拼（`rowTitle.weight(.semibold)`）
        /// ⇒ **它的字距从本档继承**（`.weight()` 带着 `trackingEm` 走）：改本档的 `em` 会连带改它。
        static let rowTitle = TypeStyle(size: 15, trackingEm: -0.005, relativeTo: .subheadline)
        /// 同上，需要强调时（`15/500`）。
        static let rowTitleEmphasis = TypeStyle(size: 15, trackingEm: -0.005, weight: .medium, relativeTo: .subheadline)
        /// 下拉触发文本、按钮、单选标签（`14/400`，字距 `-0.005em`）。
        static let control = TypeStyle(size: 14, trackingEm: -0.005, relativeTo: .subheadline)
        /// 同上，需要强调时（`14/500`）。
        static let controlEmphasis = TypeStyle(size: 14, trackingEm: -0.005, weight: .medium, relativeTo: .subheadline)
        /// 状态文案、分段控件、徽章、抽屉按钮（`13/400`，字距 `-0.01em`）。
        static let status = TypeStyle(size: 13, trackingEm: -0.01, relativeTo: .footnote)
        /// 帮助弹层里说明块的标题（`13/600`）。**这一档不是 `statusEmphasis` 的别名**（那是 `500`）；
        /// Android 用 `status.copy(fontWeight = sheetTitle.fontWeight)` 表达同一档。
        static let blockTitle = TypeStyle(size: 13, trackingEm: -0.01, weight: .semibold, relativeTo: .footnote)
        /// 同上，需要强调时（`13/500`）。
        static let statusEmphasis = TypeStyle(size: 13, trackingEm: -0.01, weight: .medium, relativeTo: .footnote)
        /// 首页电源砖下的状态行（手机，`17/600`）：压在大砖下面，`13` 那一档撑不起「连没连上」这一层级。
        static let heroStatus = TypeStyle(size: 17, trackingEm: -0.01, weight: .semibold, relativeTo: .body)
        /// 副标题、速率读数（`12/400`）。无字距 ⇒ 显式 `0`。
        static let subtitle = TypeStyle(size: 12, trackingEm: 0, relativeTo: .caption)
        /// 元信息、页脚（`11/500`）。**`0`**：`0.04em` 只属于大写的那一档，
        /// 而元信息与页脚不大写 ⇒ 这一档没有字距。
        static let meta = TypeStyle(size: 11, trackingEm: 0, weight: .medium, relativeTo: .caption2)
        /// 说明脚注（`11/400`）：常驻页脚那种「这件事什么时候生效」的一句话。
        ///
        /// **`11` 这一档有三个角色，三个字重，而它们不是不一致**：
        /// **区段小标题 `11/600`（`sectionLabel`）· 元信息 `11/500`（`meta`）· 说明脚注 `11/400`（本条）**。
        /// **叫 `note` 不叫 `footnote`**：后者与 SwiftUI 的语义字体样式 `Font.footnote` 撞名，
        /// `.font(Theme.TypeScale.footnote)` 与 `.font(.footnote)` **只差一个前缀**，读代码的人分不开。
        static let note = TypeStyle(size: 11, trackingEm: 0, relativeTo: .caption2)
        /// 区段小标题（`11/600`，大写 + 字距 `0.04em`）。
        /// **与 `meta`(11/500) 的区别只在字重，而角色不同**：`meta` 是元信息 / 页脚，
        /// 这一个是区段小标题与**同档要求 600 的图标**（如速率箭头）。
        /// **`0.04em` 的依据是角色**：全大写配紧字距 `0.04em`，Title Case 才配宽字距 `0.08em`；
        /// 本仓的区段小标题是**全大写**。
        static let sectionLabel = TypeStyle(size: 11, trackingEm: 0.04, weight: .semibold, relativeTo: .caption2)
        /// 协议徽章、dock 标签（`10/600`）。无字距 ⇒ 显式 `0`。
        static let badge = TypeStyle(size: 10, trackingEm: 0, weight: .semibold, relativeTo: .caption2)
    }

    /// 一档字阶的描述：字号、字重、字形设计，以及**按哪一档系统文本样式缩放**。
    ///
    /// 它不是 `Font`：`Font.system(size:)` 是定值、不随动态字号变，而把 `@ScaledMetric` 写进
    /// 每个调用点不现实。故字阶给描述，缩放在 `View.font(_:)` 那一处做。
    struct TypeStyle {
        let size: CGFloat
        /// 字距的 **`em` 系数**。
        ///
        /// **必填、无默认值，而这是它的全部用处**：新加一档而不写字距 ⇒ **编译不过**。
        /// 没有字距的那几档落成**显式 `0`** ⇒ **「没有字距」与「忘了写」分得开**。
        ///
        /// **为什么是 `em` 而不是磅值**：字距要与字号**同源**——`View.font(_:)` 用 `@ScaledMetric`
        /// 放大字号，磅值定值不跟着放大 ⇒ **动态字体越大、字距相对越紧**，那是无障碍缺陷。
        ///
        /// **为什么住在这里而不是一张「字号 → 字距」的表**：`11` 那一档**同号不同字距**
        /// （`sectionLabel` 大写 `0.04em` · `meta` 不大写 `0`）
        /// ⇒ **字距是每个角色的属性，不是每个字号的属性**，按字号查表表达不出这两个值。
        let trackingEm: CGFloat
        var weight: Font.Weight = .regular
        var design: Font.Design = .default
        var usesMonospacedDigit = false
        let relativeTo: Font.TextStyle

        init(
            size: CGFloat,
            trackingEm: CGFloat,
            weight: Font.Weight = .regular,
            design: Font.Design = .default,
            usesMonospacedDigit: Bool = false,
            relativeTo: Font.TextStyle
        ) {
            self.size = size
            self.trackingEm = trackingEm
            self.weight = weight
            self.design = design
            self.usesMonospacedDigit = usesMonospacedDigit
            self.relativeTo = relativeTo
        }

        /// 等宽字形（与 `Font.monospaced()` 同义）。
        func monospaced() -> TypeStyle {
            var copy = self
            copy.design = .monospaced
            return copy
        }

        /// 等宽数字（与 `Font.monospacedDigit()` 同义）：只把数字定宽，字母仍按比例。
        func monospacedDigit() -> TypeStyle {
            var copy = self
            copy.usesMonospacedDigit = true
            return copy
        }

        /// 换字重（与 `Font.weight(_:)` 同义）。
        func weight(_ weight: Font.Weight) -> TypeStyle {
            var copy = self
            copy.weight = weight
            return copy
        }
    }

    struct Shadow {
        let color: Color
        let radius: CGFloat
        var x: CGFloat = 0
        var y: CGFloat = 0
    }

    /// 页顶晕染：页面顶上一抹冷色，向下融进页面底色。
    enum PageTint {
        /// 各页的常态。
        case neutral
        /// 已连接的首页：浓一档，接住电源砖的蓝色光晕。
        case accent

        /// 晕染在页面整高（含安全区）的这一比例处完全融进底色。
        static let fadeExtent: CGFloat = 0.44

        /// 晕染顶端那一抹。**只是 `accent` 换不透明度，不另立色值**：色相跟着 `accent` 走，
        /// 两端共有的调色板不多出一格。
        ///
        /// 不透明度按主题分：同样的 α 压在黑底上读起来弱得多。亮色的取值顾着次级文字——
        /// `neutral` 顶端压 `textSecondary` 仍有 `4.54`，任何页面顶上放次级文字都达标；
        /// `accent` 顶端是 `4.28`，离页顶 `12.4%` 页高之后才回到 `4.5`，它只铺在首页，那一带是电源砖。
        func top(in scheme: ColorScheme) -> Color {
            let opacity: Double
            switch (self, scheme) {
            case (.neutral, .dark): opacity = 0.14
            case (.neutral, _): opacity = 0.08
            case (.accent, .dark): opacity = 0.18
            case (.accent, _): opacity = 0.12
            }
            return Theme.accent.opacity(opacity)
        }
    }

    /// 首页电源砖与光晕的光学层。
    ///
    /// 这是全仓**唯一**更重的一份材质，也是唯一一处三层光学（渐变填充 + 内侧高光 + 外侧光晕）。
    /// 取值集中在这里而不是就地写进组件：「本文件之外禁止出现任何色值」对它一视同仁。
    enum Hero {
        /// 未连接 / 连接中：近白渐变（暗色主题为近黑渐变）。
        static let idleStart = dyn(0xFFFFFF, 0x2C2C2E)
        static let idleMiddle = dyn(0xFAFAFC, 0x232325)
        static let idleEnd = dyn(0xF2F2F6, 0x1C1C1E)

        /// 已连接：`accent` 系渐变（浅 → accent → 深）。
        static let activeStart = dyn(0x4DA3FF, 0x409CFF)
        static let activeMiddle = dyn(0x0062CC, 0x0A84FF)
        static let activeEnd = dyn(0x004FA6, 0x0051D5)

        /// 内侧高光：顶边与左边各一道亮线（顶边更亮），底边一道极淡暗线。
        static let idleEdgeHighlight = dynAlpha(0xFFFFFF, 0.98, 0xFFFFFF, 0.06)
        /// 左边那一道（未连接）。**两个数直接来自参考**（`inset 1.5px 0 0 rgba(255,255,255,.65)`，
        /// 暗色 `.04`）⇒ **对位，非派生**。
        static let idleEdgeHighlightLeading = dynAlpha(0xFFFFFF, 0.65, 0xFFFFFF, 0.04)
        static let idleEdgeShade = dynAlpha(0x3C3C43, 0.08, 0x000000, 0.40)
        static let activeEdgeHighlight = dynAlpha(0xFFFFFF, 0.42, 0xFFFFFF, 0.42)
        /// 左边那一道（已连接）。**派生，非对位**：参考里没有 on 态的内高光读数，
        /// 故按未连接那一对的比值折算 —— `0.42 × (0.65 / 0.98) ≈ 0.28`。
        static let activeEdgeHighlightLeading = dynAlpha(0xFFFFFF, 0.28, 0xFFFFFF, 0.28)
        static let activeEdgeShade = dynAlpha(0x000000, 0.15, 0x000000, 0.30)

        /// 未连接 / 连接中的外侧光晕：与砖同形、不偏移的一圈中性柔光（`radius` 按基准砖 `160` 给）。
        /// 不向下偏移——那是投影，读起来是砖浮在页面上方，与平卡同页时层级自相矛盾。
        /// 已连接不需要这一圈：`auraCore` 那团蓝色光晕就是它。
        static let idleGlow = Shadow(
            color: dynAlpha(0x3C3C43, 0.16, 0xEBEBF5, 0.07),
            radius: 14
        )

        /// 光晕：中心 `accent` 三成不透明度 → `66%` 处完全透明。
        static let auraCore = dynAlpha(0x0062CC, 0.30, 0x0A84FF, 0.30)
    }

    /// 时长常量族。**按场景命名，不按数值** ——同一个值出现在两个场景里是对的，不要合并。
    /// 对位 Android 的 `object Motion`。
    enum Motion {
        /// 电源砖底色与外侧光晕。
        static let heroSurface: Double = 0.28
        /// 电源砖按下形变；**按下那一半更快**（`140ms`，按下态 `120ms`）。
        static let heroPress: Double = 0.14
        static let heroPressDown: Double = 0.12
        /// 光晕透明度。
        static let heroAura: Double = 0.4
        /// 展开抽屉高度。启动失败弹层的展开**与它同形**，取同一档而不是页面切换那一档。
        static let drawerHeight: Double = 0.22
        /// 行悬停 —— 「行悬停 / 通用颜色过渡 `120–150ms`」那一档的下沿。
        static let rowHover: Double = 0.12
        /// 通用颜色过渡 —— 「行悬停 / 通用颜色过渡 `120–150ms`」那一档的上沿。
        /// 控件选中、按下，以及 `colorTransition(_:)` 这个通用修饰符都取它。
        static let colorTransition: Double = 0.15
        /// 屏内内容整块替换（空态 ↔ 内容、阶段切换、连接态…）。`contentSwapTransition(_:)` 取它。
        static let contentSwap: Double = 0.30
        /// 进度条宽度。
        static let gaugeFill: Double = 0.4
        /// 滚动到端点。**这一档不配主缓动** —— 唯一的例外，各端走自己的 ease-in-out。
        static let scrollToEdge: Double = 0.25
    }

    /// 主缓动：全仓只有这一条曲线，时长由调用方按时长表给。
    static func motion(_ duration: Double) -> Animation {
        .timingCurve(0.32, 0.72, 0, 1, duration: duration)
    }

    /// 一个主题分支下的取值：色 + 不透明度。两者恒成对出现，故聚合成一件事传。
    private struct Ink {
        let rgb: UInt32
        let alpha: Double

        init(_ rgb: UInt32, _ alpha: Double = 1) {
            self.rgb = rgb
            self.alpha = alpha
        }
    }

    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        dynamic(light: Ink(light), dark: Ink(dark))
    }

    private static func dynAlpha(
        _ light: UInt32,
        _ lightAlpha: Double,
        _ dark: UInt32,
        _ darkAlpha: Double
    ) -> Color {
        dynamic(light: Ink(light, lightAlpha), dark: Ink(dark, darkAlpha))
    }

    private static func dynamic(light: Ink, dark: Ink) -> Color {
        return Color(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let ink = isDark ? dark : light
            return UIColor(rgb: ink.rgb, alpha: ink.alpha)
        })
    }
}

private extension UIColor {
    convenience init(rgb: UInt32, alpha: Double) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: CGFloat(alpha)
        )
    }
}

struct AppTheme: ViewModifier {
    func body(content: Content) -> some View {
        content.tint(Theme.accent)
    }
}

extension View {
    func appTheme() -> some View { modifier(AppTheme()) }

    /// 页面根背景：页面底色 + 页顶晕染，铺满含安全区，各 Screen 根部一行调用。
    /// 晕染取哪一档由调用方给，除已连接的首页外都是 `.neutral`。
    ///
    /// **它同时压住顶上 chrome 那一带**（状态栏与导航栏）：根屏挂的是
    /// `.toolbar(.hidden, for: .navigationBar)`
    /// ⇒ **那一带没有任何材质** ⇒ 内容滚上去直接压在它底下。
    /// 用不透的页底而不是半透材质：半透材质下模糊的内容仍然看得见。
    func screenBackground(_ tint: Theme.PageTint = .neutral) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity)
            .pageBackdrop(tint)
            .overlay(alignment: .top) { TopChromeBand(tint: tint) }
    }

    /// 只铺页底（底色 + 页顶晕染，含安全区），不带顶部遮挡。页面一律用 `screenBackground`；
    /// 本入口给的是**不随页面移动的那层地**。
    func pageBackdrop(_ tint: Theme.PageTint) -> some View {
        background { PageBackdrop(tint: tint).ignoresSafeArea() }
    }

    /// 页面内容的统一边距：水平 + 顶部。
    ///
    /// 水平默认 `16`；首页是唯一取 `20` 的页面，由它显式传。顶部各页不同（英雄区页面
    /// 留得更多），故也由调用方给。
    ///
    /// **底部不在这里给**：内容底部避让由导航壳统一负责，页面不自己加。
    /// 壳补的量按 dock 形态分两种算法，且安全区只能算一次——见 `AppNav` 的 `dockClearance`。
    /// 名字里不带「scroll」：不可滚动的页面（配置页固定标题条、配置详情弹层）同样用它。
    func pageInsets(top: CGFloat, horizontal: CGFloat = Theme.Spacing.large) -> some View {
        padding(.horizontal, horizontal)
            .padding(.top, top)
            // **内容吃满可读宽并靠左**：下面两层里的外层为了居中那个 `600` 宽的块而存在，
            // 它同样会把窄内容顶到居中。这一层让内容在可读宽**之内**靠左，外层让可读宽的块**居中**；
            // 对填满宽度的内容是恒等。
            .frame(maxWidth: .infinity, alignment: .leading)
            // **内容最大可读宽度**：窗口 / 屏再宽只加两侧留白，不把一行字拉长。
            // **两层 `frame` 是必须的**：内层把内容收到 `600`，外层吃满可用宽把它顶到居中；
            // 只写内层那一个，内容会贴着起始边而不是居中。
            // **上限含页边距**（那个 `600` 是「正文 552 + 卡内衬与页边距约 57」推出来的）
            // ⇒ 故挂在 `padding` **之外**。窄于 `600` 时两层都是恒等，手机与固定窄窗零改动。
            .frame(maxWidth: Theme.maxReadableWidth)
            .frame(maxWidth: .infinity)
    }

    /// 按字阶设字体。**字阶随动态字号缩放就落在这一处**：
    /// `@ScaledMetric` 只能写在 `View` 里，写进每个调用点不现实，故收在这个修饰符里，
    /// 调用点仍旧写 `.font(Theme.TypeScale.rowTitle)`，一个字都不用改。
    func font(_ style: Theme.TypeStyle) -> some View {
        modifier(ScaledTypeStyle(style: style))
    }

    /// 分组卡的**底与形一起给**。卡片一律调它，不要只拼一句 `.background(surface, in:)`——
    /// 那样**内容不裁进卡形**：滚动列表的行会越过圆角画到卡外，卡的圆角下沿横在内容中间；
    /// 行的悬停 / 按下填充是无圆角的整行矩形，卡的四角会被它啃成直角。
    ///
    /// 故这里先 `clipShape` 把内容裁进形，再把填充画在形状本身上。卡是平的，不投影、不画渐变。
    func cardSurface(cornerRadius: CGFloat = Theme.Radius.card) -> some View {
        clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: cornerRadius))
    }

    /// **带纵向内衬的卡面**：`padding(.vertical, 4)` + `cardSurface()`。
    ///
    /// 分组卡自身的纵向内衬 `4`：卡与其内容之间的呼吸量，且第一行 / 最后一行的按压填充不贴着圆角沿。
    /// 同形的卡一律调它，不各写两行。
    func insetCardSurface(cornerRadius: CGFloat = Theme.Radius.card) -> some View {
        padding(.vertical, Theme.Spacing.extraSmall)
            .cardSurface(cornerRadius: cornerRadius)
    }

    /// 内容整块替换：空态 ↔ 内容、阶段切换、列表整体变化。取 `Motion.contentSwap`。
    ///
    /// **不是「页面切换」**——那是**切根**，消费方是 `AppNav.selectedTab`。
    /// **本函数不含那 `5` 上移**：`TimedTransition` 只挂 `.animation`，位移属于页面切换。
    func contentSwapTransition(_ value: some Equatable) -> some View {
        modifier(TimedTransition(duration: Theme.Motion.contentSwap, value: value))
    }

    /// 颜色态切换（`150ms`）：容器色、前景色、选中色。
    func colorTransition(_ value: some Equatable) -> some View {
        modifier(TimedTransition(duration: Theme.Motion.colorTransition, value: value))
    }
}

/// 两个入口共用的实现：尊重「减少动态效果」（开启时状态即时切换，保留直接的颜色反馈）。
///
/// **时长不设缺省值**：调用方经两个具名入口之一选定时长，选错也看得见。
private struct TimedTransition<Value: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let duration: Double
    let value: Value

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : Theme.motion(duration), value: value)
    }
}

// i18n：key 与 Android strings.xml 逐字同名；值在 Localizable.xcstrings。
func tr(_ key: String) -> String {
    NSLocalizedString(key, comment: "")
}

func tr(_ key: String, _ args: CVarArg...) -> String {
    String(format: NSLocalizedString(key, comment: ""), arguments: args)
}


/// `View.font(Theme.TypeStyle)` 的实现：`@ScaledMetric` 把字阶的字号按其 `relativeTo` 那一档
/// 的动态字号曲线缩放，再拼回一个具体的 `Font`。
private struct ScaledTypeStyle: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let style: Theme.TypeStyle

    init(style: Theme.TypeStyle) {
        self.style = style
        _size = ScaledMetric(wrappedValue: style.size, relativeTo: style.relativeTo)
    }

    func body(content: Content) -> some View {
        content
            .font(resolvedFont)
            // 字距与字号**同源**：`size` 已经是 `@ScaledMetric` 放大后的值，
            // 故放大一次、字距跟着走。
            // **无条件挂**：写 `0` 的那几档挂上去也是 `0`，而「有没有挂」不再是一个可漏的动作。
            .tracking(size * style.trackingEm)
    }

    private var resolvedFont: Font {
        let base = Font.system(size: size, weight: style.weight, design: style.design)
        return style.usesMonospacedDigit ? base.monospacedDigit() : base
    }
}

/// 页底：底色 + 顶上那一抹晕染。页面背景与顶部遮挡画的必须是同一张，故收成一个视图。
private struct PageBackdrop: View {
    let tint: Theme.PageTint
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let top = tint.top(in: colorScheme)
        Theme.background.overlay {
            // 终点取同一色的零不透明度：一路只有 α 在变，色相不随插值漂移。
            LinearGradient(
                stops: [
                    .init(color: top, location: 0),
                    .init(color: top.opacity(0), location: Theme.PageTint.fadeExtent),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

/// 顶上 chrome 那一带的不透遮挡。画的是**同一张页底的那一截**而不是一块纯色：
/// 页顶有晕染，纯色会在带子下沿切出一道接缝。
///
/// 页底铺满含安全区的整高，这里按同一高度重画一张、只留顶上那一截，两张逐行对齐。
private struct TopChromeBand: View {
    let tint: Theme.PageTint

    var body: some View {
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            PageBackdrop(tint: tint)
                .frame(height: insets.top + proxy.size.height + insets.bottom)
                .frame(height: insets.top, alignment: .top)
                .clipped()
                .offset(y: -insets.top)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
