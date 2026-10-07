import Foundation

// 配置更新执行记录的单一时间线：后台与手动共用一条线，
// 追加时按「条数上限 + 保留天数」两条同时逐出。时刻由调用方注入，本类型不读时钟。
// 与 Android core/RefreshRecordStore.kt 逐字对应，golden/refresh-record-store.json 是行为裁判。

/// 这次执行由谁发起。
public enum RefreshTrigger: String, Sendable {
    case auto = "AUTO"
    case manual = "MANUAL"
}

/// 这次执行的结局，与 ConfigRefresh 的写回结局一一对应。
public enum RefreshRecordOutcome: String, Sendable {
    case updated = "UPDATED"
    case dropped = "DROPPED"
    case failed = "FAILED"
}

/// 一次抓取的记录。
///
/// **绝不含加速地址的任何形态**（明文、脱敏或哈希预映像）——走没走加速只由 `route` 表达。
public struct RefreshRecord: Equatable, Sendable {
    public let occurredAtMillis: Int64
    public let profileId: String
    public let profileName: String
    public let trigger: RefreshTrigger
    public let outcome: RefreshRecordOutcome
    public let contentChanged: Bool
    public let durationMillis: Int64
    public let route: FetchRoute
    /// 未回落时的拒绝理由；走了加速或未触发判定则为 nil。
    public let denial: FallbackDenial?
    /// 失败 token（ImportError 的 token）；成功为 ""。
    public let errorToken: String
    public let usedTraffic: Int64
    public let totalTraffic: Int64
    public let expireTime: Int64

    public init(
        occurredAtMillis: Int64,
        profileId: String,
        profileName: String,
        trigger: RefreshTrigger,
        outcome: RefreshRecordOutcome,
        contentChanged: Bool,
        durationMillis: Int64,
        route: FetchRoute,
        denial: FallbackDenial?,
        errorToken: String,
        usedTraffic: Int64,
        totalTraffic: Int64,
        expireTime: Int64
    ) {
        self.occurredAtMillis = occurredAtMillis
        self.profileId = profileId
        self.profileName = profileName
        self.trigger = trigger
        self.outcome = outcome
        self.contentChanged = contentChanged
        self.durationMillis = durationMillis
        self.route = route
        self.denial = denial
        self.errorToken = errorToken
        self.usedTraffic = usedTraffic
        self.totalTraffic = totalTraffic
        self.expireTime = expireTime
    }
}

public final class RefreshRecordStore {
    /// 落盘文件名。**放在这里而不是让每个消费方各写一份字面量**：
    /// **任一处笔误都不会有人报错**，只会让那一处安静地读到一个空文件。
    /// 住在共享模块里的名字无一例外被引用；住在模块外的无一例外被抄。
    public static let fileName = "refresh-records.store"


    public static let maxRecords = 200
    public static let maxAgeMillis: Int64 = 30 * 24 * 60 * 60 * 1000

    private let storage: RefreshRecordStorage
    // 内存持有的是「旧在前」的追加序，与落盘序一致；对外一律新在前。
    private var records: [RefreshRecord]

    public init(storage: RefreshRecordStorage) {
        self.storage = storage
        if let bytes = storage.load(), let text = String(data: bytes, encoding: .utf8) {
            records = RefreshRecordCodec.decode(text)
        } else {
            records = []
        }
    }

    /// 时间线，最新在前（倒序呈现）。
    public func all() -> [RefreshRecord] { records.reversed() }

    /// 追加一条并落盘；以新记录的时刻为基准逐出过期与超额条目。
    public func append(_ record: RefreshRecord) {
        records.append(record)
        evict(nowMillis: record.occurredAtMillis)
        persist()
    }

    public func clear() {
        records.removeAll()
        persist()
    }

    private func evict(nowMillis: Int64) {
        let cutoff = nowMillis - Self.maxAgeMillis
        records.removeAll { $0.occurredAtMillis < cutoff }
        if records.count > Self.maxRecords {
            records.removeFirst(records.count - Self.maxRecords)
        }
    }

    private func persist() {
        storage.save(Data(RefreshRecordCodec.encode(records).utf8))
    }
}

enum RefreshRecordCodec {
    private static let version = "v1"
    private static let fieldCount = 13

    /// 首行版本，其后每行一条记录（旧在前）。
    static func encode(_ records: [RefreshRecord]) -> String {
        var out = version
        for r in records {
            out += "\n"
            out += "\(r.occurredAtMillis)\t"
            out += "\(TextEscape.escape(r.profileId))\t"
            out += "\(TextEscape.escape(r.profileName))\t"
            out += "\(r.trigger.rawValue)\t"
            out += "\(r.outcome.rawValue)\t"
            out += "\(r.contentChanged ? "1" : "0")\t"
            out += "\(r.durationMillis)\t"
            out += "\(r.route.rawValue)\t"
            out += "\(r.denial?.rawValue ?? "")\t"
            out += "\(TextEscape.escape(r.errorToken))\t"
            out += "\(r.usedTraffic)\t"
            out += "\(r.totalTraffic)\t"
            out += "\(r.expireTime)"
        }
        out += "\n"
        return out
    }

    /// 解析期 fail-loud：版本不识、字段数不符、token 未知一律崩，不静默丢记录。
    static func decode(_ text: String) -> [RefreshRecord] {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard let header = lines.first, !header.isEmpty else { return [] }
        precondition(header == version, "unsupported refresh record store version: \(header)")
        return lines.dropFirst().filter { !$0.isEmpty }.map(decodeRecord)
    }

    private static func decodeRecord(_ line: Substring) -> RefreshRecord {
        let f = line.split(separator: "\t", omittingEmptySubsequences: false)
        precondition(f.count == fieldCount, "refresh record needs \(fieldCount) fields, got \(f.count)")
        guard let occurredAtMillis = Int64(f[0]),
              let trigger = RefreshTrigger(rawValue: String(f[3])),
              let outcome = RefreshRecordOutcome(rawValue: String(f[4])),
              let durationMillis = Int64(f[6]),
              let route = FetchRoute(rawValue: String(f[7])),
              let usedTraffic = Int64(f[10]),
              let totalTraffic = Int64(f[11]),
              let expireTime = Int64(f[12]) else {
            preconditionFailure("malformed refresh record: \(line)")
        }
        let denial: FallbackDenial? = f[8].isEmpty ? nil : {
            guard let value = FallbackDenial(rawValue: String(f[8])) else {
                preconditionFailure("unknown fallback denial token: \(f[8])")
            }
            return value
        }()
        return RefreshRecord(
            occurredAtMillis: occurredAtMillis,
            profileId: TextEscape.unescape(f[1]),
            profileName: TextEscape.unescape(f[2]),
            trigger: trigger,
            outcome: outcome,
            contentChanged: f[5] == "1",
            durationMillis: durationMillis,
            route: route,
            denial: denial,
            errorToken: TextEscape.unescape(f[9]),
            usedTraffic: usedTraffic,
            totalTraffic: totalTraffic,
            expireTime: expireTime
        )
    }
}
