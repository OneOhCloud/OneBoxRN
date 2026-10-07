// 发送窗口内只保留最新日志：UI 观察不能向隧道制造无界反压。
public struct ObservationPendingLogBuffer: Sendable {
    public static let capacity = 200

    private var entries = [LogLine?](repeating: nil, count: capacity)
    private var firstIndex = 0
    public private(set) var count = 0

    public init() {}

    public mutating func append(_ line: LogLine) {
        if count < Self.capacity {
            entries[(firstIndex + count) % Self.capacity] = line
            count += 1
            return
        }
        entries[firstIndex] = line
        firstIndex = (firstIndex + 1) % Self.capacity
    }

    public mutating func drain() -> [LogLine] {
        drain(maxEntries: count)
    }

    public mutating func drain(maxEntries: Int) -> [LogLine] {
        let drainedCount = min(max(maxEntries, 0), count)
        guard drainedCount > 0 else { return [] }
        var drained: [LogLine] = []
        drained.reserveCapacity(drainedCount)
        for offset in 0..<drainedCount {
            let index = (firstIndex + offset) % Self.capacity
            if let line = entries[index] {
                drained.append(line)
                entries[index] = nil
            }
        }
        firstIndex = (firstIndex + drainedCount) % Self.capacity
        count -= drainedCount
        if count == 0 { firstIndex = 0 }
        return drained
    }

    /// 未发出项比期间新到日志更旧；容量不足时先舍弃这些旧项。
    public mutating func prepend(_ lines: ArraySlice<LogLine>) {
        for line in lines.reversed() where count < Self.capacity {
            firstIndex = (firstIndex - 1 + Self.capacity) % Self.capacity
            entries[firstIndex] = line
            count += 1
        }
    }
}
