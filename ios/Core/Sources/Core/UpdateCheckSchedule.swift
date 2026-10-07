import Foundation

// 何时检查更新：冷启动必查，成功后隔一个周期再查，失败按指数退避重试且不超过一个周期。
// 与 Android core/UpdateCheckSchedule.kt 同名同义，
// golden/update-check-schedule.json 是行为裁判。时间均为 Unix 毫秒。

public struct UpdateCheckInput: Sendable {
    public let nowMillis: Int64
    /// nil = 从未成功过。
    public let lastSuccessMillis: Int64?
    /// nil = 从未尝试过。
    public let lastAttemptMillis: Int64?
    /// 自上次成功以来连续失败的次数。
    public let consecutiveFailures: Int
    public let coldStart: Bool

    public init(nowMillis: Int64, lastSuccessMillis: Int64?, lastAttemptMillis: Int64?,
                consecutiveFailures: Int, coldStart: Bool) {
        self.nowMillis = nowMillis
        self.lastSuccessMillis = lastSuccessMillis
        self.lastAttemptMillis = lastAttemptMillis
        self.consecutiveFailures = consecutiveFailures
        self.coldStart = coldStart
    }
}

/// `due` 为 true 时 `nextCheckAtMillis` 等于当前时间。
public struct UpdateCheckPlan: Equatable, Sendable {
    public let due: Bool
    public let nextCheckAtMillis: Int64

    public init(due: Bool, nextCheckAtMillis: Int64) {
        self.due = due
        self.nextCheckAtMillis = nextCheckAtMillis
    }
}

public enum UpdateCheckSchedule {
    public static let periodMillis: Int64 = 6 * 60 * 60 * 1000
    public static let backoffBaseMillis: Int64 = 5 * 60 * 1000

    public static func plan(_ input: UpdateCheckInput) throws -> UpdateCheckPlan {
        guard input.consecutiveFailures >= 0 else {
            throw UpdateInputError(message: "negative failure count: \(input.consecutiveFailures)")
        }
        guard input.consecutiveFailures == 0 || input.lastAttemptMillis != nil else {
            throw UpdateInputError(message: "failures without an attempt time")
        }
        let now = input.nowMillis
        if input.coldStart { return UpdateCheckPlan(due: true, nextCheckAtMillis: now) }
        // 晚于当前时间的记录说明时钟回拨过；按它等下去可能要等上回拨的那一整段，故视作没有这条记录。
        let successDue = input.lastSuccessMillis.flatMap { $0 <= now ? $0 + periodMillis : nil }
        let backoffDue = input.lastAttemptMillis.flatMap {
            $0 <= now && input.consecutiveFailures > 0 ? $0 + backoff(input.consecutiveFailures) : nil
        }
        guard let dueAt = [successDue, backoffDue].compactMap({ $0 }).max() else {
            return UpdateCheckPlan(due: true, nextCheckAtMillis: now)
        }
        return now >= dueAt ? UpdateCheckPlan(due: true, nextCheckAtMillis: now) : UpdateCheckPlan(due: false, nextCheckAtMillis: dueAt)
    }

    /// min(周期, 基数 × 2^(失败次数-1))；先封顶指数，免得移位溢出。
    private static func backoff(_ failures: Int) -> Int64 {
        var delay = backoffBaseMillis
        for _ in 1..<failures {
            delay *= 2
            if delay >= periodMillis { return periodMillis }
        }
        return delay
    }
}

/// 手动检查的最短可见时长：检查早于它结束也等满再揭晓结果，否则「检查中」一闪而过，
/// 用户读不出「刚才确实查过了」。golden/update-check-pacing.json 是行为裁判。
public enum UpdateCheckPacing {
    public static let minimumVisibleMillis: Int64 = 1000

    /// 揭晓结果前还要再等的毫秒数。`elapsedMillis` 取单调时钟，为负即调用方用错了时钟。
    public static func revealDelayMillis(elapsedMillis: Int64) throws -> Int64 {
        guard elapsedMillis >= 0 else {
            throw UpdateInputError(message: "negative elapsed time: \(elapsedMillis)")
        }
        return max(0, minimumVisibleMillis - elapsedMillis)
    }
}

/// 更新判定的入参不成立（版本串非点分十进制、记账不自洽等）。与 Android 的 IllegalArgumentException 同义。
public struct UpdateInputError: Error, Equatable {
    public let message: String
}
