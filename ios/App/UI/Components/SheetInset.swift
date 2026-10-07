import SwiftUI

/// 弹层面板的内衬账。
///
/// **面板内衬取 `20`**：与首页页边距同档。
///
/// **不从圆角反推**：「内层圆角 = 外层圆角 − 内衬」管的是嵌套块的圆角，拿它倒推内衬
/// （`18 − 12 = 6`）会让输入框与按钮几乎贴着 `371` 宽弹层的左右边。
///
/// **内衬只约束带底色的块**：纯文本行（标题、说明）在它之外再各自左右内缩 `10`，
/// 标题与块里的文字才落在同一条读字边线上。
enum SheetInset {
    /// 面板内衬：带底色的圆角块到面板边的距离。
    static let panel: CGFloat = 20
    /// 纯文本行在面板内衬之外再内缩的量。
    static let textExtra: CGFloat = 10
}

extension View {
    /// 弹层固定页脚的内衬与底色（规则编辑器 / 引擎参数编辑器共用）。
    ///
    /// 页脚必须不透明（表单在它下面滚），**且与面板同色**：面板取 `surface`，这里若仍画 `background`，
    /// 明亮态是一条 `#F7F7F7` 压 `#FFFFFF` 的色带、暗色态是纯黑压 `#1C1C1E`——
    /// 那是用色差画的一条分隔带。
    func actionBarChrome() -> some View {
        padding(.horizontal, SheetInset.panel)
            .padding(.top, Theme.Spacing.small)
            .background(Theme.surface)
    }
}
