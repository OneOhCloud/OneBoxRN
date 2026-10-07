import Foundation

// UI → :tun 的命令与快照应答编码（承载于官方 sendProviderMessage / handleAppMessage 请求-响应）。
//
// 观察数据走单向 datagram，命令走这条请求-响应通道：Apple 只提供 App 发起的 App↔扩展通道，
// 扩展无法主动发起，因此两条通道方向天然互补。
public enum ObservationCommand: Sendable, Equatable {
    case selectNode(tag: String)
    case urlTest(tag: String)
    /// UI 挂载时索取当前快照，免干等下一次推送（对应 Android 侧 register 回放）。
    case snapshotRequest
    /// 热重载：就地换引擎。载荷 = 命令字节 + 重载 id——最新配置经 App Group 的
    /// `TunnelStartOptionsSnapshot` 传递，不进消息体。
    ///
    /// id 存在的理由：结局要落到一个独立于本条应答的地方，而落下的那份必须能被
    /// 认领——没有 id 就分不清读到的是本次的结局还是上一次遗留的。
    case reload(id: UInt64)
}

public enum ObservationCommandCodec {
    /// tag 来自订阅，长度不可信：超限即拒而非截断——截断会打到错误的节点上。
    public static let maxTagBytes = 512

    private enum Kind: UInt8 {
        case selectNode = 1
        case urlTest = 2
        case snapshotRequest = 3
        case reload = 4
    }

    public static func encode(_ command: ObservationCommand) -> Data {
        var data = Data()
        switch command {
        case .selectNode(let tag):
            data.append(Kind.selectNode.rawValue)
            data.append(Data(tag.utf8))
        case .urlTest(let tag):
            data.append(Kind.urlTest.rawValue)
            data.append(Data(tag.utf8))
        case .snapshotRequest:
            data.append(Kind.snapshotRequest.rawValue)
        case .reload(let id):
            data.append(Kind.reload.rawValue)
            data.append(ReloadId.encode(id))
        }
        return data
    }

    public static func decode(_ data: Data) -> ObservationCommand? {
        guard let first = data.first, let kind = Kind(rawValue: first) else { return nil }
        let payload = data.dropFirst()
        guard payload.count <= maxTagBytes else { return nil }
        switch kind {
        case .selectNode:
            guard !payload.isEmpty else { return nil }
            return .selectNode(tag: String(decoding: payload, as: UTF8.self))
        case .urlTest:
            guard !payload.isEmpty else { return nil }
            return .urlTest(tag: String(decoding: payload, as: UTF8.self))
        case .snapshotRequest:
            guard payload.isEmpty else { return nil }
            return .snapshotRequest
        case .reload:
            guard let id = ReloadId.decode(payload) else { return nil }
            return .reload(id: id)
        }
    }
}

/// 重载 id 的线上表示：8 字节大端。命令载荷与落盘结局共用这一处，两边分头写就会各自定义字节序。
enum ReloadId {
    static let byteCount = 8

    static func encode(_ id: UInt64) -> Data {
        Data((0..<byteCount).reversed().map { UInt8(truncatingIfNeeded: id >> (8 * $0)) })
    }

    /// 长度不足或多余一律拒——多出来的字节意味着对端与本端对载荷的理解不同，猜它等于放过一个 bug。
    static func decode(_ data: some Collection<UInt8>) -> UInt64? {
        guard data.count == byteCount else { return nil }
        return data.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }
}

/// 快照应答：UI 挂载时的起始状态。running 由引擎 start/stop 驱动，不依赖内核是否推过状态。
///
/// **不带引擎自陈**：App 的引擎版本是构建期注入的，从不读快照。
/// 留着一个没人读的字段比删掉更糟：它**看起来**仍像引擎自陈的来源。
public struct ObservationSnapshot: Sendable, Equatable {
    public let traffic: Traffic?
    public let groups: [NodeGroup]
    public let running: Bool

    public init(traffic: Traffic?, groups: [NodeGroup], running: Bool) {
        self.traffic = traffic
        self.groups = groups
        self.running = running
    }
}

public enum ObservationSnapshotCodec {
    /// 同 `GroupsSnapshotCodec.encode`：DTO 是本仓自有类型，编码失败必是本仓 bug。
    /// 折成空 `Data()` 会让索取快照的一侧收到一份解不开的应答，UI 就此停在空态而无人知情。
    public static func encode(_ snapshot: ObservationSnapshot) -> Data {
        let dto = SnapshotDto(snapshot)
        do {
            return try JSONEncoder().encode(dto)
        } catch {
            preconditionFailure("observation snapshot not encodable: \(describe(error))")
        }
    }

    public static func decode(_ data: Data) -> ObservationSnapshot? {
        guard let dto = try? JSONDecoder().decode(SnapshotDto.self, from: data) else { return nil }
        return dto.toSnapshot()
    }
}

private struct SnapshotDto: Codable {
    let up: Int64?
    let down: Int64?
    let upTotal: Int64?
    let downTotal: Int64?
    let memory: Int64?
    // JSON 可选字段天然向后兼容：旧应答缺此键解出 nil，按 0（生产侧不可用）处理。
    let memoryPeak: Int64?
    let connIn: Int?
    let connOut: Int?
    let groups: Data
    let running: Bool

    init(_ snapshot: ObservationSnapshot) {
        up = snapshot.traffic?.up
        down = snapshot.traffic?.down
        upTotal = snapshot.traffic?.upTotal
        downTotal = snapshot.traffic?.downTotal
        memory = snapshot.traffic?.memory
        memoryPeak = snapshot.traffic?.memoryPeak
        connIn = snapshot.traffic?.connIn
        connOut = snapshot.traffic?.connOut
        groups = GroupsSnapshotCodec.encode(snapshot.groups)
        running = snapshot.running
    }

    func toSnapshot() -> ObservationSnapshot {
        var traffic: Traffic?
        if let up, let down, let upTotal, let downTotal, let memory, let connIn, let connOut {
            traffic = Traffic(
                up: up, down: down, upTotal: upTotal, downTotal: downTotal,
                memory: memory, memoryPeak: memoryPeak ?? 0, connIn: connIn, connOut: connOut
            )
        }
        return ObservationSnapshot(
            traffic: traffic,
            groups: GroupsSnapshotCodec.decode(groups) ?? [],
            running: running
        )
    }
}



/// 热重载结局的应答编码：成功为空载荷，失败携中立错误。
///
/// 与快照应答分开：那条是「给我当前状态」，这条是「你刚才那件事成了没有」——合成一个
/// 会让等待方要先判断收到的是哪一种。
public enum ReloadOutcomeCodec {
    /// detail 按**字符**而不是字节设限：按字节截会把一个多字节字符劈成两半，解码端只能得到
    /// 替换字符——诊断文本里最不该出现的就是乱码。
    public static let maxDetailCharacters = 1024

    /// token 长度用一个字节编码，故有 255 字节的硬顶。
    private static let maxTokenBytes = 255

    /// 超长 token 的降级目标。**不静默截断**：截出来的是一个「看着像 token 的别的东西」，
    /// 而 token 是要被检索和跨机器比对的。降级到稳定值并把原文塞进 detail，信息不丢。
    private static let overlongTokenFallback = "RELOAD_FAILED"

    public static func encodeSuccess() -> Data { Data() }

    public static func encodeFailure(_ error: EngineError) -> Data {
        var token = Data(error.token.utf8)
        var detail = String(error.detail?.prefix(maxDetailCharacters) ?? "")
        if token.count > maxTokenBytes {
            detail = "token=\(error.token); \(detail)"
            detail = String(detail.prefix(maxDetailCharacters))
            token = Data(overlongTokenFallback.utf8)
        }
        var data = Data([UInt8(token.count)])
        data.append(token)
        data.append(Data(detail.utf8))
        return data
    }

    /// 成功返回 nil（无错误即成功）；坏应答按失败处置——静默当成功会让隧道停在一个没人知道的状态。
    public static func decode(_ data: Data) -> EngineError? {
        if data.isEmpty { return nil }
        guard let tokenLength = data.first.map(Int.init), data.count >= 1 + tokenLength else {
            return EngineError(token: "RELOAD_FAILED", detail: "malformed reload outcome")
        }
        let token = String(decoding: data.dropFirst().prefix(tokenLength), as: UTF8.self)
        let detail = String(decoding: data.dropFirst(1 + tokenLength), as: UTF8.self)
        return EngineError(token: token, detail: detail.isEmpty ? nil : detail)
    }
}
