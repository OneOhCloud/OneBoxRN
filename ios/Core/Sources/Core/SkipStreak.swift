// 一条事件流里连续被跳过的那一段：段开始交出一次，本段每种成因第一次出现各交出一次，段结束交出
// 一次汇总；其余跳过只计数。
//
// 被跳过的事件不能无声消失，但逐个记日志会在引擎启动、重载或设备 Doze 这类持续数秒到数小时的
// 状态里刷屏，把真正的状态迁移淹掉。已经出现过的成因再切回来也只计数：两种成因交替出现时，
// 每次切换都交出一次就退化成逐事件一行；切换有多频繁记在汇总的 `causeChanges` 里。
// 日志行数因此只随「本段出现了几种成因」增长，与事件数无关；汇总带出每种成因的次数与总数。
public struct SkipStreak<Cause: Equatable> {

    public struct CauseCount: Equatable {
        public let cause: Cause
        public let count: Int64

        public init(cause: Cause, count: Int64) {
            self.cause = cause
            self.count = count
        }
    }

    /// 一段的账：各成因按第一次出现的先后排列。计数 64 位且溢出即崩溃，两端同宽，不会悄悄绕回。
    public struct Summary: Equatable {
        public let counts: [CauseCount]
        public let total: Int64
        /// 相邻两次跳过成因不同的次数。
        public let causeChanges: Int64

        public init(counts: [CauseCount], total: Int64, causeChanges: Int64) {
            self.counts = counts
            self.total = total
            self.causeChanges = causeChanges
        }
    }

    public enum Transition: Equatable {
        /// 一段跳过开始，带这一段的第一个成因。
        case began(Cause)
        /// 本段第一次出现这个成因。
        case newCause(Cause)
        /// 这一段结束（事件又送达了，或这条流随会话结束）。
        case ended(Summary)
    }

    private var counts: [CauseCount] = []
    private var last: Cause?
    private var total: Int64 = 0
    private var causeChanges: Int64 = 0

    public init() {}

    /// 进行中那一段的账；没有进行中的段时为 nil。
    public var current: Summary? {
        last.map { _ in Summary(counts: counts, total: total, causeChanges: causeChanges) }
    }

    /// 记一次跳过。
    public mutating func skip(_ cause: Cause) -> Transition? {
        defer {
            last = cause
            total += 1
        }
        guard let previous = last else {
            counts = [CauseCount(cause: cause, count: 1)]
            return .began(cause)
        }
        if previous != cause { causeChanges += 1 }
        guard let index = counts.firstIndex(where: { $0.cause == cause }) else {
            counts.append(CauseCount(cause: cause, count: 1))
            return .newCause(cause)
        }
        counts[index] = CauseCount(cause: cause, count: counts[index].count + 1)
        return nil
    }

    /// 这条流恢复送达，或随会话结束收尾；没有进行中的一段就什么都不交出。
    public mutating func end() -> Transition? {
        guard let summary = current else { return nil }
        counts = []
        last = nil
        total = 0
        causeChanges = 0
        return .ended(summary)
    }
}
