import Foundation
import Observation
import Core

// 配置查看页真实驱动：状态提升——每次进入页面（onAppear → reload）按当前输入重算，
// 全部派生数据（合并输出、格式化投影、逐行切分）在本状态层一次算好并页内缓存，段切换是纯选择、
// 零计算。Imported = 激活 profile 原文（零改写）；Merged 视图与复制 = 合并输出的
// 确定性格式化投影（引擎字节仍为紧凑输出）。MergeError 在本 UI 边界转失败可重试态
// （领域错误）；模板/锚点类缺陷仍在合并器内崩溃暴露，不在此捕获。
/// 配置查看页对动作层的**全部**依赖（测试缝）：只此四项，AppTests 据此注入替身，
/// 使重入/取消/释放这类生命周期行为可被自动验证。
@MainActor
protocol ConfigViewActions: AnyObject {
    var activeConfigContent: String { get }
    var routingMode: RoutingMode { get }
    func mergeInput() -> MergeInput
}

extension AppActions: ConfigViewActions {}

@MainActor
@Observable
final class ConfigViewModel {
    enum Source: CaseIterable {
        case imported
        case merged
    }

    enum MergeDisplay: Equatable {
        case loading
        case ready(lines: TextLines, copyText: String)
        case failed(String)
    }

    /// 「已复制」短暂反馈时长。
    private static let copiedFeedbackDuration: Duration = .seconds(2)

    private let actions: ConfigViewActions

    /// 引擎版本按选核分派读取；元信息行随核变化（与设置页脚同一唯一读取口）。

    /// 视图切换是纯选择，无任何计算副作用。
    private(set) var source: Source = .imported

    private(set) var mergeDisplay: MergeDisplay = .loading

    /// 就绪态的元信息派生（+N 出站 · DNS），随合并一并计算。
    private(set) var mergedMeta: MergedConfigMeta?

    /// 激活 profile 原文（nil = 无激活，整页空态）与其预切分行（状态提升）。
    private(set) var importedText: String?
    /// nil = 未加载或已释放（与 `importedText` 同步；`TextLines("")` 是「一行空行」的
    /// 合法文档，不能拿来当「没有内容」的哨兵）。
    private(set) var importedLines: TextLines?

    private(set) var copied = false
    private(set) var copyCount = 0
    @ObservationIgnored private var copyRevertTask: Task<Void, Never>?

    /// 在途合并：新请求作废旧请求；**离页须显式取消**——`Task` 是非结构化的，
    /// 释放句柄不会取消它，而 `computeMerge` 是静态函数、不持有本对象，ViewModel 被回收后
    /// 合并/重解析/pretty/切行仍会跑完（与 Android `release()` 的取消对齐）。
    @ObservationIgnored private var mergeTask: Task<Void, Never>?

    init(actions: ConfigViewActions, engineVersion: String) {
        self.actions = actions
        engineVersionLabel = "engine " + engineVersion
    }

    /// **每次进入页面**按当前输入重取原文并重算（与 Android `LaunchedEffect { reload() }` 同形）。
    ///
    /// 不放在 `init`：两端的 ViewModel 都比页面活得久，`init` 只跑一次。iOS 的 `TabView` 不重建未选中
    /// 的 tab、`settingsPath` 由 AppNav 持有，切走再回来是同一个 VM——把加载放 `init` 就意味着此后
    /// 输入再变也不会重取：切到配置 tab 改路由模式再回来，元信息行随 actions 实时更新，正文却
    /// 仍是旧模式的合并结果，同屏自相矛盾。
    func reload() {
        let content = actions.activeConfigContent
        // 原文与行视图**同拍发布**：两者分别门控页面与正文，若分两次发布就会出现「工具栏已可复制、
        // 正文却空白」的中间态。行视图现在只是一趟偏移扫描（不再逐行分配），同步构造即可，
        // 不必为它引入异步窗口。
        if content.isEmpty {
            importedText = nil
            importedLines = nil
        } else {
            importedText = content
            importedLines = TextLines(content)
        }
        mergedMeta = nil
        runMerge()
    }

    /// 元信息行左侧：引擎版本 · 路由模式。
    let engineVersionLabel: String

    var modeLabelKey: String {
        actions.routingMode == .tunRules ? "settings_routing_mode_rules" : "settings_routing_mode_global"
    }

    /// 视图切换是纯选择，零计算（派生数据已在 init/runMerge 提升到状态层）；切视图重置复制反馈。
    func selectSource(_ value: Source) {
        source = value
        copyRevertTask?.cancel()
        copied = false
    }

    /// 可用性随视图联动：导入视图复制原文字节；合并视图仅就绪态，复制格式化投影全文。
    var copyableText: String? {
        switch source {
        case .imported:
            return importedText
        case .merged:
            guard case .ready(_, let copyText) = mergeDisplay else { return nil }
            return copyText
        }
    }

    /// 进入页面执行一次；失败态重试重跑（同输入幂等）。重计算跑全局执行器，主线程零阻塞。
    ///
    /// 新请求先作废旧请求（与 Android `mergeJob?.cancel()` 对齐）。只靠 `[weak self]` 不够：
    /// 那只丢弃结果，整份合并 + 重解析 + pretty 编码 + 切行照样跑到底。反复重试或反复重入本页
    /// 会因此堆叠并发合并，每个各自物化一份完整投影；且旧任务后完成会覆盖新结果——按完成顺序
    /// 而非请求顺序落盘，是实打实的正确性缺陷。
    func runMerge() {
        guard importedText != nil else { return } // 无激活 profile：页面呈现空态，合并段不可达
        mergeTask?.cancel()
        mergeDisplay = .loading
        let input = actions.mergeInput()
        mergeTask = Task { [weak self] in
            guard let outcome = await Self.computeMerge(input), !Task.isCancelled, let self else { return }
            switch outcome {
            case .success(let computed):
                self.mergedMeta = computed.meta
                self.mergeDisplay = .ready(lines: computed.lines, copyText: computed.pretty)
            case .failure(let message):
                self.mergedMeta = nil
                self.mergeDisplay = .failed(message)
            }
        }
    }

    /// 离页释放：释放全部派生数据并取消在途计算，与 Android `release()` 同形。
    ///
    /// 派生副本（逐行视图、合并投影与其元信息）不该比页面活得久——两端的 VM 都跨页存活。
    /// 非结构化 `Task` 尤其要显式取消：它不随对象释放而取消，`computeMerge` 是静态函数、
    /// 不持有本对象，会把合并/重解析/pretty/切行整套跑完。重入由 `reload()` 按当前输入重算。
    func release() {
        mergeTask?.cancel()
        mergeTask = nil
        copyRevertTask?.cancel()
        copyRevertTask = nil
        importedLines = nil
        mergeDisplay = .loading
        mergedMeta = nil
        // 回落任务被取消后不会再复位，否则重入同一 VM 会永久显示「已复制」。
        copied = false
    }

    /// 当前视图全文写入系统剪贴板 + 短暂「已复制」反馈（触感在 UI 层随 copyCount 触发）。
    func copyCurrent() {
        guard let text = copyableText else {
            preconditionFailure("copy invoked without copyable body")
        }
        Clipboard.write(text)
        copyCount += 1
        copied = true
        copyRevertTask?.cancel()
        copyRevertTask = Task { [weak self] in
            try? await Task.sleep(for: Self.copiedFeedbackDuration)
            guard !Task.isCancelled else { return }
            self?.copied = false
        }
    }

    // —— 状态提升的重计算（nonisolated：跑全局执行器，与 Android 侧 Dispatchers.Default 对齐）——

    private struct ComputedMerge: Sendable {
        let pretty: String
        let lines: TextLines
        let meta: MergedConfigMeta
    }

    private enum MergeOutcome: Sendable {
        case success(ComputedMerge)
        case failure(String)
    }

    /// 返回 `nil` = 已被作废。四段重活之间设取消点：单靠调用方丢弃结果只省下一次赋值，
    /// 合并、重解析、pretty 编码、切行仍会各自物化一份完整投影。
    private nonisolated static func computeMerge(_ input: MergeInput) async -> MergeOutcome? {
        do {
            let merged = try ConfigMerge.merge(input)
            if Task.isCancelled { return nil }
            let tree: JsonValue
            do {
                tree = try Json.parse(merged)
            } catch {
                // 合并输出出自确定性编码，重解析失败 = 内部不变量破坏（崩溃类）。
                preconditionFailure("merge output failed to reparse: \(error)")
            }
            if Task.isCancelled { return nil }
            let pretty = Json.encodePretty(tree)
            if Task.isCancelled { return nil }
            return .success(ComputedMerge(
                pretty: pretty,
                lines: TextLines(pretty),
                meta: MergedConfigMeta.parse(merged)
            ))
        } catch let error as MergeError {
            // 导入内容来自外部 → 领域错误，失败可重试态并附详情。
            return .failure(error.message)
        } catch {
            preconditionFailure("mergedConfig threw non-MergeError: \(error)")
        }
    }

}
