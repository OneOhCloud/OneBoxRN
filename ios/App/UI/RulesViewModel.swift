import Observation
import Core

// 路由规则页真实驱动：列表 = RuleStore 快照（规范序唯一实现于 core）；
// 增删改经 AppActions（持久化 + restartIfRunning 单点）；搜索为本地呈现层过滤。
@MainActor
@Observable
final class RulesViewModel {
    /// 搜索阈值单一来源。
    nonisolated static let searchThreshold = 12

    private let actions: AppActions
    var searchText = "" {
        didSet {
            if searchText != oldValue { scheduleProjection() }
        }
    }
    private(set) var filteredRules: [Rule]
    @ObservationIgnored private var projectionTask: Task<Void, Never>?
    @ObservationIgnored private var projectedSource: [Rule]

    init(actions: AppActions) {
        self.actions = actions
        let rules = actions.rules
        filteredRules = rules
        projectedSource = rules
    }

    /// 规范序快照（排序在 RuleStore 维护，本层零排序实现）。
    var rules: [Rule] { actions.rules }

    var showsSearch: Bool { rules.count >= Self.searchThreshold }

    /// RuleStore 快照变化后重算呈现投影；由 RulesScreen 的 task(id:) 连接观察依赖。
    func synchronizeRules() {
        let currentRules = rules
        guard currentRules != projectedSource else { return }
        projectedSource = currentRules
        if currentRules.count < Self.searchThreshold, !searchText.isEmpty {
            searchText = ""
        } else {
            scheduleProjection()
        }
    }

    // 变更三入口的隧道处置单点在 AppActions（restartIfRunning）；
    // 重启失败诊断已由其落 lastError → 全局失败弹层单点呈现，本层不二次呈现（try? 非吞错）。

    /// 批量添加（编辑器只交有效 token；幂等去重在 RuleStore.add）。
    func add(action: RuleAction, kind: RuleKind, values: [String]) {
        precondition(!values.isEmpty, "composer must not save empty rule batch")
        let newRules = values.map { Rule(action: action, kind: kind, value: $0) }
        Task { try? await actions.addRules(newRules) }
    }

    /// 编辑提交 = replace（可跨 action 迁移；与既有条目重复时幂等去重）。
    func replace(old: Rule, new: Rule) {
        Task { try? await actions.replaceRule(old: old, new: new) }
    }

    /// 确认后的删除；规则数回落阈值下时清空搜索词（搜索框随之收起）。
    func remove(_ rule: Rule) {
        Task {
            try? await actions.removeRule(rule)
            if !showsSearch { searchText = "" }
        }
    }

    private func scheduleProjection() {
        projectionTask?.cancel()
        let rules = projectedSource
        let query = searchText
        guard RulesSearchProjection.needsFiltering(rules: rules, query: query) else {
            filteredRules = rules
            return
        }
        projectionTask = Task { [weak self] in
            do {
                try await Task.sleep(for: RuleProjectionTiming.debounce)
            } catch {
                return
            }
            let worker = Task.detached(priority: .userInitiated) {
                RulesSearchProjection.filter(rules: rules, query: query)
            }
            let projection = await worker.value
            guard !Task.isCancelled else { return }
            self?.filteredRules = projection
        }
    }
}

enum RuleProjectionTiming {
    static let debounce: Duration = .milliseconds(150)
}

/// 规则搜索的纯呈现投影：后台执行，规则存储的规范序保持不变。
enum RulesSearchProjection {
    /// 显式空白集（空格/制表/`\n`/`\r`），与 ImportLink、ConfigCheck 同一集合。
    /// 不用各自的原生 trim：`.whitespacesAndNewlines` 会裁掉 U+0085 而 Kotlin 的 `trim()`
    /// 不会（Java 的 `isWhitespace` 不认它），一条只含 U+0085 的查询会一端返回全部规则、
    /// 另一端返回空。
    private static func normalized(_ query: String) -> String {
        let scalars = query.unicodeScalars
        func isSpace(_ s: Unicode.Scalar) -> Bool { s == " " || s == "\t" || s == "\n" || s == "\r" }
        var start = scalars.startIndex
        var end = scalars.endIndex
        while start < end, isSpace(scalars[start]) { start = scalars.index(after: start) }
        while end > start, isSpace(scalars[scalars.index(before: end)]) { end = scalars.index(before: end) }
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }

    static func needsFiltering(rules: [Rule], query: String) -> Bool {
        rules.count >= RulesViewModel.searchThreshold && !normalized(query).isEmpty
    }

    static func filter(rules: [Rule], query: String) -> [Rule] {
        let normalizedQuery = normalized(query)
        guard needsFiltering(rules: rules, query: normalizedQuery) else {
            return rules
        }
        // 大小写折叠取 **locale 无关**的 `lowercased()`，与 `LogKeywordFilter.matches` 同一决定：
        // `localizedCaseInsensitiveContains` 随系统语言变（土耳其语的 `I` 是经典反例），
        // 同一条查询会在两台设备上筛出不同结果，也与 Android 的 `ignoreCase = true`（locale 无关）分歧。
        let needle = normalizedQuery.lowercased()
        return rules.filter { $0.value.lowercased().contains(needle) }
    }
}
