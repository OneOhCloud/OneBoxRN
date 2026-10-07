import Foundation

// 配置文件的纯逻辑存储：模型 + 按 url 幂等 upsert + active 选择 + 序列化，经 ProfileStorage 端口持久化。
// 序列化用最小手写编码（无第三方依赖）：字段以 tab 分隔、记录以换行分隔，内容中的这些字符被转义。
// 内存态只持元信息与激活内容，非激活内容按需回读持久化字节。
// 与 Android core/ProfileStore.kt 逐字对应；golden 语义一致。

public struct Profile: Sendable, Equatable {
    public let id: String
    public let name: String
    public let url: String
    public let usedTraffic: Int64
    public let totalTraffic: Int64
    public let expireTime: Int64
    /// 首次导入的时刻：重新导入不改它（参考实现同）。
    public let addedAt: Int64
    /// 导入与每次成功刷新都改写它。
    public let updatedAt: Int64
    /// 配置服务下发的站点（见 ProfileWebsite）；导入与刷新都按那一次的响应头改写，头缺失即没有站点。
    public let website: String?

    public init(
        id: String,
        name: String,
        url: String,
        usedTraffic: Int64,
        totalTraffic: Int64,
        expireTime: Int64,
        addedAt: Int64,
        updatedAt: Int64,
        website: String?
    ) {
        self.id = id
        self.name = name
        self.url = url
        self.usedTraffic = usedTraffic
        self.totalTraffic = totalTraffic
        self.expireTime = expireTime
        self.addedAt = addedAt
        self.updatedAt = updatedAt
        self.website = website
    }

    /// 同 url 重新写入时承袭既有那一份的身份：id 与首次导入时刻。
    func inheriting(identityOf existing: Profile) -> Profile {
        Profile(
            id: existing.id,
            name: name,
            url: url,
            usedTraffic: usedTraffic,
            totalTraffic: totalTraffic,
            expireTime: expireTime,
            addedAt: existing.addedAt,
            updatedAt: updatedAt,
            website: website
        )
    }
}

/// 刷新写回的元信息：流量三字段、这次写回的时刻与这次响应带来的站点。
public struct RefreshedMetadata: Sendable, Equatable {
    public let info: TrafficInfo
    public let updatedAt: Int64
    public let website: String?

    public init(info: TrafficInfo, updatedAt: Int64, website: String?) {
        self.info = info
        self.updatedAt = updatedAt
        self.website = website
    }
}

/// 改名的结局：写入了，或名称去首尾空白后为空而没写。
public enum RenameOutcome: Sendable, Equatable {
    case renamed
    case emptyName
}

public enum RefreshWrite: Sendable, Equatable {
    case applied(contentChanged: Bool)
    case dropped
}

public final class ProfileStore {
    /// 落盘文件名。**放在这里而不是让每个消费方各写一份字面量**：
    /// **任一处笔误都不会有人报错**，只会让那一处安静地读到一个空文件。
    /// 住在共享模块里的名字无一例外被引用；住在模块外的无一例外被抄。
    public static let fileName = "profiles.store"


    private let storage: ProfileStorage
    private var profiles: [Profile] = []
    private var activeId: String?

    /// 常驻内容：稳态只含激活项；写入动作期间临时多含本次写入项，落盘后即回收。
    private var residentContents: [String: String] = [:]

    public init(storage: ProfileStorage) {
        self.storage = storage
        if let bytes = storage.load() {
            let text = String(decoding: bytes, as: UTF8.self)
            let snapshot = ProfileCodec.decode(text)
            profiles = snapshot.profiles
            activeId = snapshot.activeId
            if let id = snapshot.activeId {
                residentContents[id] = ProfileCodec.content(text, id)
            }
        }
    }

    public func getAll() -> [Profile] { profiles }

    public func getActive() -> Profile? { profiles.first { $0.id == activeId } }

    /// 激活 profile 的配置内容：恒常驻，取值零 IO；无激活时为空。
    public func activeContent() -> String {
        guard let id = activeId else { return "" }
        guard let content = residentContents[id] else {
            preconditionFailure("active profile content not resident: \(id)")
        }
        return content
    }

    /// 按 id 取配置内容：激活项取常驻值，非激活项按需回读持久化字节；id 不存在即崩。
    public func contentOf(_ id: String) -> String {
        residentContents[id] ?? ProfileCodec.content(persistedText(), id)
    }

    /// 按 url 幂等 upsert：已存在则更新（保留既有 id 以免 active 悬空，保留既有 addedAt——那是首次导入的时刻），
    /// 否则新增。首个 profile 自动置为 active。
    @discardableResult
    public func upsertByUrl(_ profile: Profile, content: String) -> Profile {
        let stored = upsertInMemory(profile, content: content)
        if activeId == nil { activeId = stored.id }
        persist()
        return stored
    }

    /// 导入写入必须把 profile 与激活指针放入同一个持久化快照，避免中间状态和重复 IO。
    @discardableResult
    public func upsertByUrlAndActivate(_ profile: Profile, content: String) -> Profile {
        let stored = upsertInMemory(profile, content: content)
        activeId = stored.id
        persist()
        return stored
    }

    public func setActive(_ id: String) {
        precondition(profiles.contains { $0.id == id }, "unknown profile id: \(id)")
        let content = contentOf(id)
        activeId = id
        residentContents[id] = content
        persist()
    }

    /// 刷新写回（内容已由调用方过 ConfigCheck）：按 url 定位，无匹配 → Dropped 零写入；
    /// 命中：流量三字段、updatedAt 与 website 总是更新（已用 = upload + download），内容与旧值不同才标记 contentChanged；
    /// 不改 name/id/addedAt、不改激活指针。
    public func applyRefresh(url: String, metadata: RefreshedMetadata, content: String) -> RefreshWrite {
        guard let index = profiles.firstIndex(where: { $0.url == url }) else { return .dropped }
        let old = profiles[index]
        let contentChanged = content != contentOf(old.id)
        profiles[index] = Profile(
            id: old.id,
            name: old.name,
            url: old.url,
            usedTraffic: metadata.info.upload + metadata.info.download,
            totalTraffic: metadata.info.total,
            expireTime: metadata.info.expire,
            addedAt: old.addedAt,
            updatedAt: metadata.updatedAt,
            website: metadata.website
        )
        residentContents[old.id] = content
        persist()
        return .applied(contentChanged: contentChanged)
    }

    /// 改名：去首尾空白后写入；为空不写、返回 `.emptyName`；id 不存在即崩。
    /// 只动名称：updatedAt、内容与激活指针都不变。重新导入时服务端给了名字就覆盖它，没给则保留（见 ProfileName.derive）。
    @discardableResult
    public func rename(_ id: String, to name: String) -> RenameOutcome {
        guard let index = profiles.firstIndex(where: { $0.id == id }) else {
            preconditionFailure("unknown profile id: \(id)")
        }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .emptyName }
        let old = profiles[index]
        profiles[index] = Profile(
            id: old.id,
            name: trimmed,
            url: old.url,
            usedTraffic: old.usedTraffic,
            totalTraffic: old.totalTraffic,
            expireTime: old.expireTime,
            addedAt: old.addedAt,
            updatedAt: old.updatedAt,
            website: old.website
        )
        persist()
        return .renamed
    }

    /// 删除；require id 存在；删的是激活项则顺延剩余首条，无剩余置空。
    public func remove(_ id: String) {
        guard let index = profiles.firstIndex(where: { $0.id == id }) else {
            preconditionFailure("unknown profile id: \(id)")
        }
        profiles.remove(at: index)
        residentContents.removeValue(forKey: id)
        if activeId == id {
            activeId = profiles.first?.id
            if let promoted = activeId {
                residentContents[promoted] = contentOf(promoted)
            }
        }
        persist()
    }

    private func upsertInMemory(_ profile: Profile, content: String) -> Profile {
        let stored: Profile
        if let index = profiles.firstIndex(where: { $0.url == profile.url }) {
            stored = profile.inheriting(identityOf: profiles[index])
            profiles[index] = stored
        } else {
            stored = profile
            profiles.append(stored)
        }
        residentContents[stored.id] = content
        return stored
    }

    private func persist() {
        // 非常驻内容原样承袭旧文件字段：不做解码—再编码往返，落盘字节与内容全量常驻时代一致。
        // 全部内容都常驻时（单 profile 常态）不读旧文件。
        var previous: String?
        let text = ProfileCodec.encode(Snapshot(profiles: profiles, activeId: activeId)) { id in
            if let resident = residentContents[id] { return ProfileCodec.escape(resident)[...] }
            let stored = previous ?? persistedText()
            previous = stored
            return ProfileCodec.escapedContent(stored, id)
        }
        storage.save(Data(text.utf8))
        residentContents = residentContents.filter { $0.key == activeId }
    }

    private func persistedText() -> String {
        guard let bytes = storage.load() else { return "" }
        return String(decoding: bytes, as: UTF8.self)
    }
}

struct Snapshot {
    let profiles: [Profile]
    let activeId: String?
}

enum ProfileCodec {
    private static let version = "v1"
    private static let fieldCount = 10
    /// 升级前写下的记录止于 addedAt：照读，缺的 updatedAt 取 addedAt——那正是它最近一次被导入写下的时刻；
    /// 缺的 website 即没有站点。不单独迁移：下一次落盘整份按当前布局重写。
    private static let legacyFieldCount = 8
    private static let contentField = 6
    private static let addedAtField = 7
    private static let updatedAtField = 8
    private static let websiteField = 9

    /// 内容字段由调用方按 id 提供转义后形态，编码器不接触未常驻的内容。
    static func encode(_ snapshot: Snapshot, escapedContentOf: (String) -> Substring) -> String {
        var out = version + "\t" + escape(snapshot.activeId ?? "")
        for p in snapshot.profiles {
            out += "\n"
            out += escape(p.id) + "\t"
            out += escape(p.name) + "\t"
            out += escape(p.url) + "\t"
            out += String(p.usedTraffic) + "\t"
            out += String(p.totalTraffic) + "\t"
            out += String(p.expireTime) + "\t"
            out.append(contentsOf: escapedContentOf(p.id))
            out += "\t"
            out += String(p.addedAt) + "\t"
            out += String(p.updatedAt) + "\t"
            out += escape(p.website ?? "")
        }
        return out
    }

    /// 只解元信息：内容字段不物化，是懒加载的前提。
    static func decode(_ text: String) -> Snapshot {
        if text.isEmpty { return Snapshot(profiles: [], activeId: nil) }
        let lines = records(text)
        let header = lines[0].split(separator: "\t", omittingEmptySubsequences: false)
        precondition(header[0] == version, "unsupported profile store version: \(header[0])")
        let rawActive = unescape(header.count > 1 ? header[1] : "")
        var profiles: [Profile] = []
        for line in lines.dropFirst() where !line.isEmpty {
            let f = fields(line)
            let addedAt = Int64(f[addedAtField])!
            let legacy = f.count == legacyFieldCount
            let website = legacy ? "" : unescape(f[websiteField])
            profiles.append(
                Profile(
                    id: unescape(f[0]),
                    name: unescape(f[1]),
                    url: unescape(f[2]),
                    usedTraffic: Int64(f[3])!,
                    totalTraffic: Int64(f[4])!,
                    expireTime: Int64(f[5])!,
                    addedAt: addedAt,
                    updatedAt: legacy ? addedAt : Int64(f[updatedAtField])!,
                    website: website.isEmpty ? nil : website
                )
            )
        }
        return Snapshot(profiles: profiles, activeId: rawActive.isEmpty ? nil : rawActive)
    }

    static func content(_ text: String, _ id: String) -> String {
        unescape(escapedContent(text, id))
    }

    /// 取某条记录的内容字段原文（仍为转义形态）；无该记录即崩（元信息与内容失配）。
    static func escapedContent(_ text: String, _ id: String) -> Substring {
        for line in records(text).dropFirst() where !line.isEmpty {
            let f = fields(line)
            if unescape(f[0]) == id { return f[contentField] }
        }
        preconditionFailure("profile content not found: \(id)")
    }

    /// 行与字段一律以 Substring 视图示人（共享底层存储，不复制），调用方要什么字段才物化什么。
    private static func records(_ text: String) -> [Substring] {
        text.split(separator: "\n", omittingEmptySubsequences: false)
    }

    private static func fields(_ line: Substring) -> [Substring] {
        let f = line.split(separator: "\t", omittingEmptySubsequences: false)
        precondition(
            f.count == fieldCount || f.count == legacyFieldCount,
            "malformed profile record: expected \(fieldCount) fields, got \(f.count)"
        )
        return f
    }

    /// 旧版本写下的裸 CRLF **不做迁移**：`persist()` 对常驻内容（激活项）走本函数重新转义，
    /// 故该 profile 一旦被激活，下一次写入即自愈；非激活项原样承袭旧转义形态，
    /// 专为它加解码—再编码的迁移会打破「非激活项原样承袭」。残留窗口 = 「含 CRLF 且从未被激活」
    /// 的旧 profile，其记录在文件里仍带真换行字节。
    static func escape(_ s: String) -> String { TextEscape.escape(s) }

    private static func unescape<S: StringProtocol>(_ s: S) -> String { TextEscape.unescape(s) }
}
