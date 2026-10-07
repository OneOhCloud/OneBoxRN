import Foundation
import Core

/// 外部配置在下载与本地编译边界共用的资源上限（与 Android ConfigResourceLimits.kt 同名同值）。
///
/// `URLSession.data(for:)` 会把响应**全量缓冲**、无任何上限，不设这两个上限，
/// 一份超大响应在 Apple 会直接吃内存（隧道扩展另有 50 MiB 预算）。
enum ConfigResourceLimits {
    /// 单一来源在 core `ConfigMerge`：合并入口持有该上限，抓取侧只是提前一步拒绝。
    static let maxImportedConfigSize = ConfigMerge.maxImportedConfigSize
    static let maxCompiledConfigSize = maxImportedConfigSize * 2
}
