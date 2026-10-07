import Foundation
import SQLite3
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "LegacyDataImport")

/// 上一代应用的数据一次性导入：覆盖安装升级后首次装配数据时跑一次，之后永不再跑。
///
/// 上一代把全部状态存在 App 沙盒 `Documents/SQLite/config.db` 的 `kv_store(key, value)` 表里；
/// 本类型只读不写那份库，换算与落库是 core `LegacyImport` 的事。没有那份库（全新安装）也记成已完成。
/// 读库失败不记完成：下次启动再试，而不是把用户的配置永久丢在旧库里。
enum LegacyDataImport {
    private static let doneKey = "legacy-import-done"

    static func run(profiles: ProfileStore, rules: RuleStore) {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: doneKey) else { return }
        let database = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SQLite/config.db")
        if FileManager.default.fileExists(atPath: database.path) {
            guard let entries = readEntries(database) else { return }
            let plan = LegacyImport.plan(entries)
            LegacyImport.apply(
                plan,
                profiles: profiles,
                rules: rules,
                newId: { UUID().uuidString.lowercased() },
                nowMillis: Int64(Date().timeIntervalSince1970 * 1000)
            )
            if let mode = plan.routingMode { RoutingModePreference.store(mode) }
            logger.log("legacy data imported: profiles=\(plan.profiles.count) rules=\(plan.rules.count)")
        }
        defaults.set(true, forKey: doneKey)
    }

    /// 只读打开；表不存在或库损坏返回 nil（留待下次启动再试）。
    private static func readEntries(_ database: URL) -> [String: String]? {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(database.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            logger.error("legacy data unreadable: \(String(cString: sqlite3_errmsg(handle)), privacy: .public)")
            sqlite3_close(handle)
            return nil
        }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "SELECT key, value FROM kv_store", -1, &statement, nil) == SQLITE_OK else {
            logger.error("legacy data unreadable: \(String(cString: sqlite3_errmsg(handle)), privacy: .public)")
            return nil
        }
        defer { sqlite3_finalize(statement) }
        var entries: [String: String] = [:]
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else {
                logger.error("legacy data unreadable: \(String(cString: sqlite3_errmsg(handle)), privacy: .public)")
                return nil
            }
            guard let key = sqlite3_column_text(statement, 0), let value = sqlite3_column_text(statement, 1) else { continue }
            entries[String(cString: key)] = String(cString: value)
        }
        return entries
    }
}
