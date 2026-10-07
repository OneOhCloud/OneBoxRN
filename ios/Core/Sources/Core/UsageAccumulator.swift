import Foundation

/// 隧道会话内的流量累计器。
///
/// **逐帧累计、分钟提交**：每一帧都把「本帧累计值 − 上一帧累计值」加进 `pendingUp` / `pendingDown`，
/// 到点才落盘。不能改成「每分钟比较一次累计值」——引擎在分钟中途重启会让计数器归零，
/// 那样只记得到重启后的那一段（100 → 150 → 重置 → 20 会记成 20，真实是 70）。
///
/// 时刻取自单调时钟（`MonotonicClock`、Android `SystemClock.elapsedRealtime()`），
/// 只用于提交节拍；小时归属另取墙钟，两者不可混用。
/// 与 Android core/UsageAccumulator.kt 逐字对应。
public struct UsageAccumulator: Sendable, Equatable {
    public static let commitIntervalMillis: Int64 = 60_000
    public static let empty = UsageAccumulator()

    public let started: Bool
    public let lastUpTotal: Int64
    public let lastDownTotal: Int64
    public let pendingUp: Int64
    public let pendingDown: Int64
    public let lastCommitAtMillis: Int64

    public init(
        started: Bool = false,
        lastUpTotal: Int64 = 0,
        lastDownTotal: Int64 = 0,
        pendingUp: Int64 = 0,
        pendingDown: Int64 = 0,
        lastCommitAtMillis: Int64 = 0
    ) {
        self.started = started
        self.lastUpTotal = lastUpTotal
        self.lastDownTotal = lastDownTotal
        self.pendingUp = pendingUp
        self.pendingDown = pendingDown
        self.lastCommitAtMillis = lastCommitAtMillis
    }

    public var hasPending: Bool { pendingUp > 0 || pendingDown > 0 }

    /// 观察一帧累计值。
    ///
    /// 首帧按「从 0 起算」计入——引擎的累计值本就自本次 start 起从 0 长起来，
    /// 把首帧只当基线会白丢开头那一段。计数器回退（`total < 上一帧`）同样按从 0 起算。
    public func observing(atMillis: Int64, upTotal: Int64, downTotal: Int64) -> UsageAccumulator {
        precondition(
            upTotal >= 0 && downTotal >= 0,
            "traffic totals must be non-negative: up=\(upTotal) down=\(downTotal)"
        )
        guard started else {
            return UsageAccumulator(
                started: true,
                lastUpTotal: upTotal,
                lastDownTotal: downTotal,
                pendingUp: upTotal,
                pendingDown: downTotal,
                lastCommitAtMillis: atMillis
            )
        }
        return UsageAccumulator(
            started: true,
            lastUpTotal: upTotal,
            lastDownTotal: downTotal,
            pendingUp: pendingUp + Self.delta(total: upTotal, previous: lastUpTotal),
            pendingDown: pendingDown + Self.delta(total: downTotal, previous: lastDownTotal),
            lastCommitAtMillis: lastCommitAtMillis
        )
    }

    /// 是否到了提交节拍；未观察过任何帧时恒 false。
    public func shouldCommit(atMillis: Int64) -> Bool {
        started && atMillis - lastCommitAtMillis >= Self.commitIntervalMillis
    }

    /// 提交后的状态：清空待提交量并把节拍推进到本次提交时刻。
    public func committed(atMillis: Int64) -> UsageAccumulator {
        UsageAccumulator(
            started: started,
            lastUpTotal: lastUpTotal,
            lastDownTotal: lastDownTotal,
            pendingUp: 0,
            pendingDown: 0,
            lastCommitAtMillis: atMillis
        )
    }

    private static func delta(total: Int64, previous: Int64) -> Int64 {
        total >= previous ? total - previous : total
    }
}
