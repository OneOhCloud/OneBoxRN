import Observation
import Core

/// 配置页对动作层的**全部**依赖（测试缝）：成员与 Android 的 `ProfileActions` 同一组（改名除外：
/// Android 还没有改名入口），形状照 `ConfigViewActions`。有了它，刷新状态机的结局驻留与复位取消
/// 才能在无设备的门禁里验证。
@MainActor
protocol ProfileViewActions: AnyObject {
    var profiles: [Profile] { get }
    var activeProfile: Profile? { get }
    func activate(id: String) async throws
    func deleteProfile(id: String)
    @discardableResult
    func renameProfile(id: String, name: String) -> RenameOutcome
    func refreshProfile(url: String) async throws -> RefreshOutcome
    func profileContent(id: String) -> String
}

extension AppActions: ProfileViewActions {}

extension ProfileViewActions {
    /// 把一份配置切成当前配置。配置页与首页都从这里切：已是当前项就不重走一遍隧道处置，
    /// 这条守卫只写在这一处。
    func switchProfile(to id: String) async throws {
        guard id != activeProfile?.id else { return }
        try await activate(id: id)
    }
}

// 配置页真实驱动：注入动作层窄面 ProfileViewActions，
// 列表与激活指针取 profiles 快照（存储语义唯一实现于 core ProfileStore）。
// 手动刷新双入口（列表下拉 / 列表上方「更新全部」）共用 refreshAll() 单一动作来源，互斥守卫在入口。
@MainActor
@Observable
final class ProfilesViewModel {
    /// 「更新全部」的状态循环：结局驻留 2 s 后自动回闲置。
    enum RefreshState {
        case idle
        case refreshing
        case success
        case failed
    }

    /// 单行的状态药丸（同上表）：`5s` 后自动清除。
    /// 三种语义里只有成功与错误有触发源——`dropped` 是零反馈结局，不产生药丸。
    enum RowStatus {
        case updated
        case failed
    }

    /// 结局态驻留时长。
    /// 与 ConfigViewModel 的「已复制」反馈同一时长：两处都是「刚才那下成功了」的短暂回执。
    private let outcomeDwell: Duration

    /// 行内状态药丸的驻留时长（`5s` 后自动清除）。
    private let pillDwell: Duration

    /// 驻留等待的实现。默认就是真实睡眠；测试注入一个自己控制放行时机的实现，
    /// 从而不必把断言挂在墙上时间上（测试不依赖环境巧合）。
    private let dwellSleep: (Duration) async -> Void

    private let actions: ProfileViewActions
    private(set) var refreshState: RefreshState = .idle

    /// 结局态的复位任务：下次触发先取消它，否则上一轮的复位会把新状态覆写回闲置。
    private var outcomeRevertTask: Task<Void, Never>?

    /// 失败反馈：Alert 携错误信息（i18n 映射在 UI 层）；确认后清空。
    private(set) var refreshFailure: ImportError?

    /// 刷新结局触感 trigger（成功 success / 失败 error）。
    private(set) var refreshSuccessCount = 0
    private(set) var refreshFailureCount = 0

    /// 正在更新中的行。
    /// 删除没有对应的忙碌态——它是内存内的同步移除，不存在「删除中」那一拍。
    private(set) var updatingIds: Set<String> = []
    private(set) var rowStatus: [String: RowStatus] = [:]
    private var rowStatusTasks: [String: Task<Void, Never>] = [:]

    /// 结局驻留时长与其等待方式可注入：默认即 2 s / 5 s + 真实睡眠。
    init(
        actions: ProfileViewActions,
        outcomeDwell: Duration = .seconds(2),
        pillDwell: Duration = .seconds(5),
        dwellSleep: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.actions = actions
        self.outcomeDwell = outcomeDwell
        self.pillDwell = pillDwell
        self.dwellSleep = dwellSleep
    }

    var profiles: [Profile] { actions.profiles }
    var hasProfiles: Bool { !profiles.isEmpty }
    var activeId: String? { activeProfile?.id }
    var activeProfile: Profile? { actions.activeProfile }

    func profile(_ id: String) -> Profile? {
        profiles.first { $0.id == id }
    }

    /// 这一份配置存下来的原文（详情的「复制内容」）。非激活项按需回读，不常驻。
    func content(of id: String) -> String {
        actions.profileContent(id: id)
    }

    // 激活的隧道处置单点在 AppActions（applyConfigurationChange）；启动失败诊断已由其落 lastError
    // → 全局失败弹层单点呈现，本层不二次呈现，故这里不接那条异常。

    /// 点行即切换为当前配置（已是当前项的守卫在 `switchProfile(to:)`）。
    /// 正在刷新的那一行不可切：它的内容正在写回，此刻切过去拿到的是即将被替换的那一份。
    func activate(_ id: String) async {
        guard !updatingIds.contains(id) else { return }
        try? await actions.switchProfile(to: id)
    }

    /// 确认后的删除；激活提升语义在 ProfileStore.remove。
    func delete(_ id: String) {
        actions.deleteProfile(id: id)
        rowStatusTasks.removeValue(forKey: id)?.cancel()
        rowStatus[id] = nil
    }

    /// 改名：草稿原样交给动作层——去首尾空白与空名拒绝只在 core（`ProfileStore.rename`）判一次。
    func rename(_ id: String, to name: String) {
        actions.renameProfile(id: id, name: name)
    }

    /// 单行「更新」：与「更新全部」同一条刷新管线，结局落在这一行的状态药丸上。
    func update(_ id: String) {
        guard let profile = profile(id), !updatingIds.contains(id) else { return }
        Task { await updateRow(id: id, url: profile.url) }
    }

    private func updateRow(id: String, url: String) async {
        updatingIds.insert(id)
        defer { updatingIds.remove(id) }
        switch await outcome(of: url) {
        case .updated:
            showRowStatus(.updated, on: id)
            refreshSuccessCount += 1
        case .dropped:
            // 来源已删 → 零写入零反馈（预期结局而非吞错）。
            break
        case .failed(let error):
            showRowStatus(.failed, on: id)
            refreshFailureCount += 1
            refreshFailure = error
        case .cancelled:
            break
        }
    }

    /// 手动刷新全部（下拉与「更新全部」同一来源）：互斥守卫（至多一次在途，不排队不报错）。
    /// **逐份串行**——并发批量会让多个非激活 profile 的内容同时驻留内存，打破「非激活内容不进内存」。
    /// 结局汇总成一条：任一份失败即失败（携最后一个错误），否则有更新即成功，全 dropped 即无反馈。
    func refreshAll() async {
        if refreshState == .refreshing { return }
        let urls = profiles.map(\.url)
        guard !urls.isEmpty else { return } // 没有配置不可触发
        outcomeRevertTask?.cancel()
        refreshState = .refreshing

        var anyUpdated = false
        var lastFailure: ImportError?
        for url in urls {
            switch await outcome(of: url) {
            case .updated: anyUpdated = true
            case .failed(let error): lastFailure = error
            case .dropped, .cancelled: break
            }
        }

        if let lastFailure {
            enterOutcome(.failed)
            refreshFailureCount += 1
            refreshFailure = lastFailure
        } else if anyUpdated {
            enterOutcome(.success)
            refreshSuccessCount += 1
        } else {
            refreshState = .idle
        }
    }

    /// 刷新管线的结局归一。取消是调用方自己发起的，不算领域结局，故单列一支。
    private enum Outcome {
        case updated
        case dropped
        case failed(ImportError)
        case cancelled
    }

    private func outcome(of url: String) async -> Outcome {
        do {
            switch try await actions.refreshProfile(url: url) {
            case .updated: return .updated
            case .dropped: return .dropped
            case .failed(let error): return .failed(error)
            }
        } catch {
            // 刷新管线仅调用方取消可上抛（ConfigRefresh 契约）；其余一切都是本仓 bug，立即暴露。
            precondition(error is CancellationError, "unexpected refresh pipeline error: \(error)")
            return .cancelled
        }
    }

    // —— 结局驻留 ——

    /// 结局态驻留后自动回闲置：不回去的话控件永久停在「已更新」，用户再想刷新时看不到刷新图标。
    private func enterOutcome(_ outcome: RefreshState) {
        refreshState = outcome
        let dwell = outcomeDwell
        let sleep = dwellSleep
        outcomeRevertTask = Task { [weak self] in
            await sleep(dwell)
            guard !Task.isCancelled else { return }
            self?.revertOutcome(from: outcome)
        }
    }

    /// 只复位「自己那一次」的结局：驻留期间若已被新一轮刷新改写，不越权把新状态拉回闲置。
    private func revertOutcome(from outcome: RefreshState) {
        guard refreshState == outcome else { return }
        refreshState = .idle
    }

    private func showRowStatus(_ status: RowStatus, on id: String) {
        rowStatusTasks.removeValue(forKey: id)?.cancel()
        rowStatus[id] = status
        let dwell = pillDwell
        let sleep = dwellSleep
        rowStatusTasks[id] = Task { [weak self] in
            await sleep(dwell)
            guard !Task.isCancelled else { return }
            self?.clearRowStatus(id, expecting: status)
        }
    }

    /// 同 `revertOutcome`：只清自己那一次留下的药丸。
    private func clearRowStatus(_ id: String, expecting status: RowStatus) {
        guard rowStatus[id] == status else { return }
        rowStatus[id] = nil
        rowStatusTasks[id] = nil
    }

    func dismissRefreshFailure() { refreshFailure = nil }
}
