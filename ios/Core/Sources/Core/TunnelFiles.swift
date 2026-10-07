import Foundation

/// 跨 App ↔ 隧道进程边界的文件：一份封闭名单。
///
/// 两侧共用 App Group 容器，名单给出各文件的唯一相对路径，两侧不再各写一份字面量。
public enum TunnelFile: Hashable, Sendable {
    /// 启动诊断（诊断阶梯第 1 级）：隧道写、App 读与清。
    case startError
    /// 启动期引擎日志：隧道写、App 增量回读。
    case startupLog
    /// 启动阶段标记（诊断阶梯第 2 级）。
    case startStage
    case journalRotated
    case journalCurrent
    /// 热重载结局：隧道写、App 对账后清。
    case reloadOutcome
    /// 启动快照：App 写，隧道在没有启动参数（按需连接）与热重载时读。
    case startOptions
    /// 观察通道的分组快照：隧道写、App 收到失效通知后读。
    case groupsSnapshot
    /// 用量账本的一份记录文件（`<profile id>.bin` / `.now`）。
    case usageRecord(String)

    /// 诊断文件所在的子目录（相对容器根）。
    public static let diagnosticsDirectory = "Library/Logs"

    public var relativePath: String {
        switch self {
        case .startError: return "\(Self.diagnosticsDirectory)/start_error.txt"
        case .startupLog: return "\(Self.diagnosticsDirectory)/startup.log"
        case .startStage: return "\(Self.diagnosticsDirectory)/start_stage.txt"
        case .journalRotated: return "\(Self.diagnosticsDirectory)/\(TunnelJournal.rotatedFileName)"
        case .journalCurrent: return "\(Self.diagnosticsDirectory)/\(TunnelJournal.fileName)"
        case .reloadOutcome: return "reload-outcome.bin"
        case .startOptions: return TunnelStartOptionsSnapshot.fileName
        case .groupsSnapshot: return ObservationEndpoint.snapshotName
        case .usageRecord(let name): return "\(UsageHistory.directoryName)/\(name)"
        }
    }

    public static func isUsageRecordName(_ name: String) -> Bool {
        let url = URL(fileURLWithPath: name)
        guard ["bin", "now"].contains(url.pathExtension) else { return false }
        return UsageHistory.isValidRecordId(url.deletingPathExtension().lastPathComponent)
            && url.lastPathComponent == name
    }
}

public enum TunnelFilesError: Error, Equatable, CustomStringConvertible {
    /// 代办方不可达或超时：读取根本没有发生。
    case unavailable(String)
    /// 代办方执行时失败，原样带回它的描述。
    case remote(String)

    public var description: String {
        switch self {
        case .unavailable(let detail): return "tunnel service unavailable: \(detail)"
        case .remote(let detail): return "tunnel service failed: \(detail)"
        }
    }
}

public struct TunnelFileEntry: Equatable, Sendable {
    public let name: String
    public let modifiedAt: Date

    public init(name: String, modifiedAt: Date) {
        self.name = name
        self.modifiedAt = modifiedAt
    }
}

/// App 侧访问隧道进程文件的唯一入口：两侧同一 App Group 容器，直接读写（`ContainerTunnelFiles`）。
public protocol TunnelFiles: Sendable {
    /// nil = 文件不存在；存在却读不出来抛错。
    func read(_ file: TunnelFile) throws -> Data?
    func write(_ data: Data, to file: TunnelFile) throws
    /// 文件本来就不在不算失败。
    func remove(_ file: TunnelFile) throws
    func listUsageRecords() throws -> [TunnelFileEntry]
}

/// 直接落在某个容器根上的实现：App 侧与隧道侧都用它。
public struct ContainerTunnelFiles: TunnelFiles {
    public let base: URL

    public init(base: URL) {
        self.base = base
    }

    public func url(_ file: TunnelFile) -> URL {
        base.appendingPathComponent(file.relativePath)
    }

    public func read(_ file: TunnelFile) throws -> Data? {
        do {
            return try Data(contentsOf: url(file))
        } catch CocoaError.fileReadNoSuchFile {
            return nil
        }
    }

    public func write(_ data: Data, to file: TunnelFile) throws {
        let target = url(file)
        try FileManager.default.createDirectory(
            at: target.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: target, options: .atomic)
    }

    public func remove(_ file: TunnelFile) throws {
        do {
            try FileManager.default.removeItem(at: url(file))
        } catch CocoaError.fileNoSuchFile {
            return
        }
    }

    public func listUsageRecords() throws -> [TunnelFileEntry] {
        let directory = base.appendingPathComponent(UsageHistory.directoryName)
        let entries: [URL]
        do {
            entries = try FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey]
            )
        } catch CocoaError.fileReadNoSuchFile {
            return []
        }
        return try entries
            .filter { TunnelFile.isUsageRecordName($0.lastPathComponent) }
            .map { entry in
                let modified = try entry.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                return TunnelFileEntry(name: entry.lastPathComponent, modifiedAt: modified ?? .distantPast)
            }
    }
}
