import Foundation

// 本机用量账本：UTC 小时桶的定容环 + 二进制编解码 + 三档投影。
// 存储恒 UTC；时区只在投影入参（本地日边界）里出现，故本文件不需要任何日历库。
// 与 Android core/UsageHistory.kt 逐字对应。

/// 一个小时桶的上下行字节。
public struct UsageBucket: Sendable, Equatable {
    public let up: Int64
    public let down: Int64

    public init(up: Int64 = 0, down: Int64 = 0) {
        self.up = up
        self.down = down
    }
}

/// 当前小时的待落盘累计（sidecar）：与历史环分开落盘，每分钟只重写这一份。
public struct UsagePending: Sendable, Equatable {
    public static let bytes = UsageCodec.pendingBytes

    public let hourUtc: Int64
    public let up: Int64
    public let down: Int64

    public init(hourUtc: Int64, up: Int64, down: Int64) {
        self.hourUtc = hourUtc
        self.up = up
        self.down = down
    }

    public func encode() -> Data { UsageCodec.encodePending(self) }

    public static func decode(_ data: Data) -> UsageDecode<UsagePending> { UsageCodec.decodePending(data) }
}

/// 解码结局：魔数/版本/长度不符即 `unreadable`。
///
/// 这里**有意不 fail-fast**：半年账本是辅助面，为它崩掉隧道进程不成比例。
/// 消费方丢弃重建并落一行诊断日志，是本仓 fail-fast 的显式例外。
public enum UsageDecode<Value: Sendable>: Sendable {
    case loaded(Value)
    case unreadable
}

/// 投影档位。
public enum UsageTier: Sendable, CaseIterable {
    /// 今日：每格一个 UTC 小时桶。
    case today
    /// 近 30 天：每格一个本地日。
    case month
    /// 半年：每格一个连续七日块。
    case halfYear

    /// 该档所需的本地日边界数（末项是「下一日零点」，故恒比格数多一）。
    public var requiredDayBoundaries: Int {
        switch self {
        case .today: return 2
        case .month: return UsageHistory.monthDays + 1
        case .halfYear: return UsageHistory.halfYearBlocks * UsageHistory.daysPerBlock + 1
        }
    }
}

/// 投影出的一格：左闭右开的 UTC 小时区间 + 该区间的上下行合计。
public struct UsageCell: Sendable, Equatable {
    public let startHourUtc: Int64
    public let endHourUtc: Int64
    public let up: Int64
    public let down: Int64

    public init(startHourUtc: Int64, endHourUtc: Int64, up: Int64, down: Int64) {
        self.startHourUtc = startHourUtc
        self.endHourUtc = endHourUtc
        self.up = up
        self.down = down
    }
}

/// 一档投影的结果：逐格值 + 区间合计（合计恒等于逐格之和）。
public struct UsageSeries: Sendable, Equatable {
    public let cells: [UsageCell]
    public let totalUp: Int64
    public let totalDown: Int64

    public init(cells: [UsageCell], totalUp: Int64, totalDown: Int64) {
        self.cells = cells
        self.totalUp = totalUp
        self.totalDown = totalDown
    }
}

public struct UsageHistory: Sendable, Equatable {
    /// 近 30 天档的格数。
    public static let monthDays = 30

    /// 半年档：26 个连续七日块。
    public static let halfYearBlocks = 26
    public static let daysPerBlock = 7

    /// 182 天 × 24 小时。
    ///
    /// 取 182 而不是 180：半年档是 26 个连续七日块 = 182 天，环若只有 180 天，
    /// 最老那一块永远读不满——展示范围与留存范围必须逐格对齐，否则图上那两格恒为空而无人能解释。
    public static let capacity = halfYearBlocks * daysPerBlock * 24

    /// 定长记录字节数：16 字节头 + capacity × 16。
    public static let recordBytes = UsageCodec.headerBytes + capacity * UsageCodec.bucketBytes

    /// 记录数上限：与 `recordBytes` 共同保证目录总量 ≤ 20 MB，由单测断言。
    /// 超出时按最旧修改时间淘汰——「每个配置都留半年」因此表述为「最近使用的 192 个」。
    public static let maxRecords = 192

    /// 目录字节上限：断言用的单一来源，不在别处复述数字。
    public static let directoryByteBudget: Int64 = 20 * 1024 * 1024

    /// 文件系统块粒度：定长记录按块占用，容量核算必须按这个量对齐。
    public static let blockBytes = 4096

    /// 记录目录名（两端同一来源，各自 resolve 到平台容器）。
    public static let directoryName = "usage"

    /// 记录 id 形态校验：profile id 直接当文件名用，必须挡住路径穿越。
    ///
    /// 当前生成器产 UUID（`ImportFlow` 的 newId），但解码路径能接受历史上任何字符串——
    /// 存储边界不该假定输入永远由当前生成器产出（比照 Android `TunnelConfigHandoff` 的 token 正则）。
    public static func isValidRecordId(_ profileId: String) -> Bool {
        let parts = profileId.split(separator: "-", omittingEmptySubsequences: false)
        let lengths = [8, 4, 4, 4, 12]
        guard parts.count == lengths.count else { return false }
        for (part, length) in zip(parts, lengths) {
            guard part.count == length, part.allSatisfy({ $0.isHexDigit }) else { return false }
        }
        return true
    }

    public static func historyFileName(_ profileId: String) -> String { "\(requireRecordId(profileId)).bin" }

    public static func pendingFileName(_ profileId: String) -> String { "\(requireRecordId(profileId)).now" }

    private static func requireRecordId(_ profileId: String) -> String {
        precondition(isValidRecordId(profileId), "invalid usage record id")
        return profileId
    }

    public static let empty = UsageHistory(
        lastHourUtc: 0,
        buckets: Array(repeating: UsageBucket(), count: capacity)
    )

    /// 已折进本环的最后一个小时；`.now` sidecar 只有严格更新的小时才被合并（防重复计入）。
    public let lastHourUtc: Int64
    public let buckets: [UsageBucket]

    public init(lastHourUtc: Int64, buckets: [UsageBucket]) {
        precondition(
            buckets.count == Self.capacity,
            "usage history requires \(Self.capacity) buckets, got \(buckets.count)"
        )
        self.lastHourUtc = lastHourUtc
        self.buckets = buckets
    }

    /// 取某个 UTC 小时的桶；超出有效窗口（未到 / 已被覆盖）恒为零桶。
    public func bucket(hourUtc: Int64) -> UsageBucket {
        if hourUtc > lastHourUtc || hourUtc <= lastHourUtc - Int64(Self.capacity) { return UsageBucket() }
        return buckets[Self.slot(of: hourUtc)]
    }

    /// 记入一次提交。
    ///
    /// 跨小时：先把 `(lastHourUtc, hourUtc]` 覆盖的槽清零再累加（最多清一整圈）。
    /// 时钟回拨（`hourUtc < lastHourUtc`）：记入 `lastHourUtc` 的桶，不回退也不清零——
    /// 用户改一次系统时间不该把历史抹掉。
    public func recording(hourUtc: Int64, up: Int64, down: Int64) -> UsageHistory {
        precondition(up >= 0 && down >= 0, "usage delta must be non-negative: up=\(up) down=\(down)")
        let targetHour = max(hourUtc, lastHourUtc)
        var updated = targetHour > lastHourUtc ? clearedSlots(from: lastHourUtc + 1, to: targetHour) : buckets
        let slot = Self.slot(of: targetHour)
        updated[slot] = UsageBucket(up: updated[slot].up + up, down: updated[slot].down + down)
        return UsageHistory(lastHourUtc: targetHour, buckets: updated)
    }

    /// 合并 sidecar：只有严格新于 `lastHourUtc` 的 pending 才计入。
    ///
    /// 严格判据是防重复计入的关键——折盘后若进程在写新 sidecar 前被杀，旧 sidecar 仍停在
    /// 已折进环的那个小时，宽松判据会让那一小时被读成两倍。
    public func merging(_ pending: UsagePending) -> UsageHistory {
        pending.hourUtc > lastHourUtc
            ? recording(hourUtc: pending.hourUtc, up: pending.up, down: pending.down)
            : self
    }

    /// 三档投影。
    ///
    /// `dayBoundaries` 是**本地日边界**的 UTC 小时索引，升序，末项是「下一日零点」；由平台按设备
    /// 日历算出（夏令时的 23/25 小时日因此天然成立，core 不需要时区库）。
    public func project(dayBoundaries: [Int64], tier: UsageTier) -> UsageSeries {
        precondition(
            dayBoundaries.count >= tier.requiredDayBoundaries,
            "tier \(tier) requires \(tier.requiredDayBoundaries) day boundaries, got \(dayBoundaries.count)"
        )
        let cells: [UsageCell]
        switch tier {
        case .today:
            cells = hourlyCells(
                startHour: dayBoundaries[dayBoundaries.count - 2],
                endHour: dayBoundaries[dayBoundaries.count - 1]
            )
        case .month:
            cells = blockCells(dayBoundaries, blocks: Self.monthDays, daysPerBlock: 1)
        case .halfYear:
            cells = blockCells(dayBoundaries, blocks: Self.halfYearBlocks, daysPerBlock: Self.daysPerBlock)
        }
        return UsageSeries(
            cells: cells,
            totalUp: cells.reduce(0) { $0 + $1.up },
            totalDown: cells.reduce(0) { $0 + $1.down }
        )
    }

    public func encode() -> Data { UsageCodec.encodeHistory(self) }

    public static func decode(_ data: Data) -> UsageDecode<UsageHistory> { UsageCodec.decodeHistory(data) }

    /// 纪元秒 → UTC 小时索引。
    public static func hour(ofEpochSeconds seconds: Int64) -> Int64 {
        let hours = seconds / 3600
        return seconds < 0 && seconds % 3600 != 0 ? hours - 1 : hours
    }

    private func hourlyCells(startHour: Int64, endHour: Int64) -> [UsageCell] {
        stride(from: startHour, to: endHour, by: 1).map { hour in
            let value = bucket(hourUtc: hour)
            return UsageCell(startHourUtc: hour, endHourUtc: hour + 1, up: value.up, down: value.down)
        }
    }

    /// 从末尾向前取 `blocks` 块、每块 `daysPerBlock` 个日边界，保证今天落在最后一块。
    private func blockCells(_ dayBoundaries: [Int64], blocks: Int, daysPerBlock: Int) -> [UsageCell] {
        let end = dayBoundaries.count - 1
        return (0..<blocks).map { index in
            let endIndex = end - (blocks - 1 - index) * daysPerBlock
            let startIndex = endIndex - daysPerBlock
            return range(startHour: dayBoundaries[startIndex], endHour: dayBoundaries[endIndex])
        }
    }

    private func range(startHour: Int64, endHour: Int64) -> UsageCell {
        var up: Int64 = 0
        var down: Int64 = 0
        for hour in stride(from: startHour, to: endHour, by: 1) {
            let value = bucket(hourUtc: hour)
            up += value.up
            down += value.down
        }
        return UsageCell(startHourUtc: startHour, endHourUtc: endHour, up: up, down: down)
    }

    private func clearedSlots(from fromHour: Int64, to toHour: Int64) -> [UsageBucket] {
        // 空闲久于一整圈时只清一圈：从纪元零点起遍历五十万小时既无意义也慢。
        let start = max(fromHour, toHour - Int64(Self.capacity) + 1)
        var cleared = buckets
        for hour in stride(from: start, through: toHour, by: 1) {
            cleared[Self.slot(of: hour)] = UsageBucket()
        }
        return cleared
    }

    private static func slot(of hourUtc: Int64) -> Int {
        let capacity = Int64(capacity)
        return Int(((hourUtc % capacity) + capacity) % capacity)
    }
}

enum UsageCodec {
    static let headerBytes = 16
    static let bucketBytes = 16
    static let pendingBytes = 32

    private static let version: UInt16 = 1
    private static let historyMagic: [UInt8] = Array("USGE".utf8)
    private static let pendingMagic: [UInt8] = Array("USGN".utf8)

    static func encodeHistory(_ history: UsageHistory) -> Data {
        var bytes = [UInt8](repeating: 0, count: UsageHistory.recordBytes)
        writeHeader(&bytes, magic: historyMagic, hourUtc: history.lastHourUtc)
        var offset = headerBytes
        for bucket in history.buckets {
            writeInt64(&bytes, offset: offset, value: bucket.up)
            writeInt64(&bytes, offset: offset + 8, value: bucket.down)
            offset += bucketBytes
        }
        return Data(bytes)
    }

    static func decodeHistory(_ data: Data) -> UsageDecode<UsageHistory> {
        let bytes = [UInt8](data)
        guard bytes.count == UsageHistory.recordBytes, hasHeader(bytes, magic: historyMagic) else {
            return .unreadable
        }
        var buckets: [UsageBucket] = []
        buckets.reserveCapacity(UsageHistory.capacity)
        var offset = headerBytes
        for _ in 0..<UsageHistory.capacity {
            let up = readInt64(bytes, offset: offset)
            let down = readInt64(bytes, offset: offset + 8)
            if up < 0 || down < 0 { return .unreadable }
            buckets.append(UsageBucket(up: up, down: down))
            offset += bucketBytes
        }
        return .loaded(UsageHistory(lastHourUtc: readInt64(bytes, offset: 8), buckets: buckets))
    }

    static func encodePending(_ pending: UsagePending) -> Data {
        var bytes = [UInt8](repeating: 0, count: pendingBytes)
        writeHeader(&bytes, magic: pendingMagic, hourUtc: pending.hourUtc)
        writeInt64(&bytes, offset: 16, value: pending.up)
        writeInt64(&bytes, offset: 24, value: pending.down)
        return Data(bytes)
    }

    static func decodePending(_ data: Data) -> UsageDecode<UsagePending> {
        let bytes = [UInt8](data)
        guard bytes.count == pendingBytes, hasHeader(bytes, magic: pendingMagic) else { return .unreadable }
        let up = readInt64(bytes, offset: 16)
        let down = readInt64(bytes, offset: 24)
        guard up >= 0, down >= 0 else { return .unreadable }
        return .loaded(UsagePending(hourUtc: readInt64(bytes, offset: 8), up: up, down: down))
    }

    private static func writeHeader(_ bytes: inout [UInt8], magic: [UInt8], hourUtc: Int64) {
        for (index, byte) in magic.enumerated() { bytes[index] = byte }
        bytes[4] = UInt8(version & 0xFF)
        bytes[5] = UInt8((version >> 8) & 0xFF)
        writeInt64(&bytes, offset: 8, value: hourUtc)
    }

    private static func hasHeader(_ bytes: [UInt8], magic: [UInt8]) -> Bool {
        for (index, byte) in magic.enumerated() where bytes[index] != byte { return false }
        return bytes[4] == UInt8(version & 0xFF) && bytes[5] == 0
    }

    private static func writeInt64(_ bytes: inout [UInt8], offset: Int, value: Int64) {
        let raw = UInt64(bitPattern: value)
        for index in 0..<8 { bytes[offset + index] = UInt8((raw >> (index * 8)) & 0xFF) }
    }

    private static func readInt64(_ bytes: [UInt8], offset: Int) -> Int64 {
        var raw: UInt64 = 0
        for index in 0..<8 { raw |= UInt64(bytes[offset + index]) << (index * 8) }
        return Int64(bitPattern: raw)
    }
}
