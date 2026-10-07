import Foundation
import Core

/// 持久化壳的字节 IO 单点：`FileProfileStorage` / `FileRuleStorage` / `FileRefreshRecordStorage`
/// 三个平台壳共用（同一端内第三处出现即抽象）。壳本身仍各自成文件，与 Android 侧
/// 一一对应。
enum StorageFile {
    /// 读全部字节；文件不存在返回 nil —— 首次启动的正常形态。
    ///
    /// **存在却读不出来即崩溃暴露**：折成 nil 会让上层 store 当作「没有数据」从空白开始，而它
    /// 随后的任何一次写入都会把用户的配置 / 规则整份覆盖掉——一次读故障就此变成永久数据丢失，
    /// 且从发生到用户发现之间无人可见。本仓是这些文件的唯一写者，读不出来必是本仓 bug
    /// （持久化数据损坏 → 崩溃类）；Android 侧同名壳的 `file.readBytes()` 本就失败即抛，
    /// 两端在这一点上同形。
    static func load(from url: URL) -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            return try Data(contentsOf: url)
        } catch {
            preconditionFailure("persisted store unreadable (\(url.lastPathComponent)): \(describe(error))")
        }
    }

    /// 原子写全部字节。
    ///
    /// **写不进去同样崩溃暴露**：静默失败时内存态与 UI 照常显示「已保存」，用户要到下次启动
    /// 才发现刚导入的配置不见了，那时已无从追查是哪一步丢的。Android 侧 `file.writeBytes()`
    /// 失败即抛，此处不做单端的兜底。
    static func save(_ bytes: Data, to url: URL) {
        do {
            try bytes.write(to: url, options: .atomic)
        } catch {
            preconditionFailure("persisted store unwritable (\(url.lastPathComponent)): \(describe(error))")
        }
    }
}
