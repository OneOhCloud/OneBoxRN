import Foundation

/// 检查更新的跨启动记账：调度输入（成功 / 尝试时刻、连续失败数）。
struct UpdateCheckRecord: Equatable {
    var lastSuccessMillis: Int64?
    var lastAttemptMillis: Int64?
    var consecutiveFailures = 0
}

// 键的唯一定义处即此；语义（何时记、何时清）在 UpdateChecker。
struct UpdateCheckRecordStore {
    private static let lastSuccessKey = "update-check-last-success"
    private static let lastAttemptKey = "update-check-last-attempt"
    private static let failuresKey = "update-check-failures"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> UpdateCheckRecord {
        UpdateCheckRecord(
            lastSuccessMillis: (defaults.object(forKey: Self.lastSuccessKey) as? NSNumber)?.int64Value,
            lastAttemptMillis: (defaults.object(forKey: Self.lastAttemptKey) as? NSNumber)?.int64Value,
            consecutiveFailures: defaults.integer(forKey: Self.failuresKey)
        )
    }

    func save(_ record: UpdateCheckRecord) {
        write(record.lastSuccessMillis, forKey: Self.lastSuccessKey)
        write(record.lastAttemptMillis, forKey: Self.lastAttemptKey)
        defaults.set(record.consecutiveFailures, forKey: Self.failuresKey)
    }

    private func write(_ millis: Int64?, forKey key: String) {
        if let millis {
            defaults.set(NSNumber(value: millis), forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}
