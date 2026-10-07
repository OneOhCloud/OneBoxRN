import Foundation
import Core

/// 一次读取的结果：账本 + 该配置是否已有记录（无记录 → 空态，而不是一排 0 值柱）。
struct UsageRecordSnapshot: Sendable {
    let history: UsageHistory
    let hasRecord: Bool
}

/// 用量账本的 UI 侧读者。与 Android usage/UsageReader.kt 逐字对应。
///
/// 只读 + 回收：写者恒是隧道扩展，本类唯一的写动作是删除孤儿记录，
/// 且只在隧道未运行时由动作层调用（避免与运行中的采样器争同一份文件）。
struct UsageReader: Sendable {
    private let files: any TunnelFiles

    init(files: any TunnelFiles = TunnelFileAccess.current) {
        self.files = files
    }

    /// 读一个配置的账本：历史环 + 当前小时 sidecar，一次调用同时给出「有没有记录」。
    ///
    /// **先读 sidecar 再读历史环**：反过来的话，恰逢写者折盘的那一瞬（先写 .bin 再写新 .now），
    /// 会读到「折盘前的环 + 折盘后的新 sidecar」，上一小时凭空消失；本序下最坏是读到
    /// 「已折进环的旧 sidecar」，而 merging 的严格判据本就会忽略它。
    ///
    /// 存在性与内容同一次读出：分两次 IO 会在第一个小时里读到「.bin 还没有、.now 已经有」，
    /// 页面据此进空态，而数据其实已经在了。
    func load(profileId: String) -> UsageRecordSnapshot {
        guard UsageHistory.isValidRecordId(profileId) else {
            return UsageRecordSnapshot(history: UsageHistory.empty, hasRecord: false)
        }
        let pending = read(UsageHistory.pendingFileName(profileId)).flatMap(decodePending)
        let historyData = read(UsageHistory.historyFileName(profileId))
        let history = historyData.map(decodeHistory) ?? UsageHistory.empty
        return UsageRecordSnapshot(
            history: pending.map { history.merging($0) } ?? history,
            hasRecord: historyData != nil || pending != nil
        )
    }

    /// 孤儿回收：删掉已不在配置集合里的记录，并把总数压到上限内。
    /// 只在隧道未运行时调用——运行中的采样器是那些文件的唯一写者。
    func reclaim(liveProfileIds: Set<String>) {
        guard let entries = try? files.listUsageRecords() else { return }
        for entry in entries {
            guard let id = recordId(of: entry.name), !liveProfileIds.contains(id) else { continue }
            try? files.remove(.usageRecord(entry.name))
        }
        evictOldestBeyondLimit()
        excludeFromBackup()
    }

    private func evictOldestBeyondLimit() {
        guard let entries = try? files.listUsageRecords() else { return }
        let histories = entries.filter { $0.name.hasSuffix(".bin") && recordId(of: $0.name) != nil }
        guard histories.count > UsageHistory.maxRecords else { return }

        let oldestFirst = histories.sorted { $0.modifiedAt < $1.modifiedAt }
        for entry in oldestFirst.prefix(histories.count - UsageHistory.maxRecords) {
            try? files.remove(.usageRecord(entry.name))
            if let id = recordId(of: entry.name) {
                try? files.remove(.usageRecord(UsageHistory.pendingFileName(id)))
            }
        }
    }

    /// 本机口径的数据跟着云备份迁到另一台设备就不再是本设备的数，而用户无从察觉。
    /// 账本落在会被备份的共享容器里，故显式排除。
    private func excludeFromBackup() {
        var url = AppGroupPaths.usageDirectory()
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    private func read(_ name: String) -> Data? {
        (try? files.read(.usageRecord(name))) ?? nil
    }

    private func recordId(of name: String) -> String? {
        let id = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        return UsageHistory.isValidRecordId(id) ? id : nil
    }

    private func decodeHistory(_ data: Data) -> UsageHistory {
        guard case .loaded(let value) = UsageHistory.decode(data) else { return UsageHistory.empty }
        return value
    }

    private func decodePending(_ data: Data) -> UsagePending? {
        guard case .loaded(let value) = UsagePending.decode(data) else { return nil }
        return value
    }
}

/// 账本 → 某一档的投影：日历边界算在平台侧、求和在 core。
/// 用量页与配置页今日图共用本入口，避免「档位 → 需要几个日边界」这层换算出现第二份。
func projectUsage(_ history: UsageHistory, tier: UsageTier, now: Date = Date()) -> UsageSeries {
    history.project(
        // 末项是「明天零点」，故天数比边界数少一。
        dayBoundaries: localDayBoundaries(days: tier.requiredDayBoundaries - 1, now: now),
        tier: tier
    )
}

/// 本地日边界：投影所需的 UTC 小时索引序列，末项是「明天零点」。
///
/// 日历算在平台侧、求和算在 core：夏令时的 23/25 小时日因此天然成立，core 不必带时区库。
func localDayBoundaries(days: Int, now: Date = Date(), calendar: Calendar = .current) -> [Int64] {
    precondition(days >= 1, "usage projection needs at least one day")
    var boundaries: [Int64] = []
    boundaries.reserveCapacity(days + 1)
    let today = calendar.startOfDay(for: now)
    // 末项必须是「明天零点」（今天这一格的右开端），故起点回退 days - 1 天。
    for offset in 0...days {
        guard let day = calendar.date(byAdding: .day, value: offset - (days - 1), to: today) else { continue }
        boundaries.append(UsageHistory.hour(ofEpochSeconds: Int64(day.timeIntervalSince1970)))
    }
    return boundaries
}
