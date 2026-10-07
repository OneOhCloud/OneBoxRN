import Observation
import Core

// 日志页真实驱动：列表 = LogStore 唯一缓冲快照；
// 过滤只作用于呈现，清空经 store 清缓冲、过滤保持当前段。
@MainActor
@Observable
final class LogsViewModel {
    /// 过滤两段：引擎/应用各一段，默认引擎。
    enum SourceFilter: CaseIterable {
        case engine
        case app
    }

    /// 可选档全集（fatal/panic 恒 ≥ error，不单设档位）。
    static let levelOptions: [LogLevel] = [.trace, .debug, .info, .warn, .error]

    private let store: LogStore
    @ObservationIgnored private var cachedProjection: Projection?
    var filter: SourceFilter = .engine

    /// 呈现级别（五档，进入页面默认 info）；只筛呈现，两段共用。
    var levelFilter: LogLevel = .info

    /// 关键词（进入页面为空 = 不过滤）；判据在 core，只筛呈现。
    var keyword = ""

    /// 清空触发计数（UI 轻触感 trigger）。
    private(set) var clearCount = 0

    init(store: LogStore) {
        self.store = store
    }

    var isEmpty: Bool { store.isEmpty }

    /// 按来源、级别与关键词筛选呈现，三者同时成立；不改动缓冲内容（来回切换后各行仍在）。
    var filteredEntries: [LogEntry] {
        let source: LogSource = filter == .engine ? .engine : .app
        // 关键词进 key 前先归一：「tun」与「 tun 」是同一次过滤，不该各占一份缓存。
        let normalizedKeyword = LogKeywordFilter.normalize(keyword)
        // 按当前来源拉快照，不经跨源归并列表。版本进入 key，缓冲一变即重算。
        let key = ProjectionKey(
            source: source,
            level: levelFilter,
            keyword: normalizedKeyword,
            version: store.version(of: source)
        )
        if let cachedProjection, cachedProjection.key == key {
            return cachedProjection.entries
        }
        let filtered = store.snapshot(source: source).filter {
            $0.level >= levelFilter
                && LogKeywordFilter.matches(message: $0.message, keyword: normalizedKeyword)
        }
        cachedProjection = Projection(key: key, entries: filtered)
        return filtered
    }

    /// 清空缓冲，过滤保持当前段。
    func clear() {
        store.clear()
        clearCount += 1
    }
}

private struct ProjectionKey: Equatable {
    let source: LogSource
    let level: LogLevel
    let keyword: String
    let version: UInt64
}

private struct Projection {
    let key: ProjectionKey
    let entries: [LogEntry]
}
