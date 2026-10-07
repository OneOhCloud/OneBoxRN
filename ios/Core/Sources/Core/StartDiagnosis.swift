import Foundation

/// 诊断文件的一次读取结果（诊断阶梯前两级的输入形态）。
///
/// **「文件不存在」与「存在却读不出来」必须分开**：折成同一个空串就等于宣称「本次没有失败」，
/// 而后者其实是「唯一知情的那份东西取不出来」——两句话给用户的排查方向完全相反。
/// `try?` 恰恰只会给出前一句，故读侧必须显式把这三态搬进来。
public enum DiagnosticRead: Sendable, Equatable {
    /// 文件不存在——本次没有失败，或隧道进程还没写到那一步。
    case absent
    /// 读到了内容（可能是空串：启动入口清过一次）。
    case text(String)
    /// 文件在，却读不出来；关联值是失败详情。
    case unreadable(String)
}

/// 诊断阶梯前两级的合成：**隧道进程写下的引擎真因 → 启动阶段标记**，取第一个非空。
///
/// 判据住 core 而不是散在读侧：写的是隧道扩展、读的是 App，两侧各解释一遍迟早分叉，而分叉
/// 只在失败那一拍现形——那时已无从复盘。放在这里还有一个直接好处：它是纯逻辑，可被单测钉住，
/// 不必真的造出一个起不来的隧道才能验。镜像 Android `core/ReloadDiagnosis.kt` 的同类下沉。
///
/// 第 3 级（系统给出的断开原因）**不在这里**：那一级要向 `NEVPNConnection` 现问，且只在
/// 「本次尝试被系统打回」那一沿才归属本次，属平台层，见 `TunnelController.lastDisconnectError()`。
///
/// **本函数只产出事实，不产出因果**（诊断阶梯第 2 级）：阶段标记留在盘上，可能是进程死在那一步，
/// 也可能是它此刻仍在那一步上跑着。哪一种，由知道更多的调用方在前面加一句——而「宿主不等了」
/// 不是一种结局（那一支不判负），故唯一会给它加因果的是**终止沿**（会话确实落回断开）。
///
/// - Returns: nil 仅表示**两级都确认没有失败**；任一级读不出来都会返回错误而非 nil。
public func startDiagnosis(error: DiagnosticRead, stage: DiagnosticRead) -> EngineError? {
    if let failure = unreadableDiagnosis(error, file: "start error") { return failure }
    if case .text(let detail) = error {
        let trimmed = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return EngineError(token: startFailedGeneric, detail: trimmed) }
    }
    if let failure = unreadableDiagnosis(stage, file: "start stage") { return failure }
    guard case .text(let stageText) = stage else { return nil }
    let trimmed = stageText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    // 只陈述观察到的两件事实，不断言死因（诊断阶梯第 2 级）：这份标记留在盘上，可能是进程死在
    // 那一步，也可能是它此刻仍在那一步上跑着。哪一种，由知道更多的调用方去说。
    return EngineError(
        token: startFailedGeneric,
        detail: DiagnosisDetail.join([
            "no engine error was recorded",
            "the tunnel extension's last start stage was \(trimmed)",
        ])
    )
}

/// 读不出来即以领域错误浮上去：这条通道是 UI 唯一能问到引擎真因的地方，静默折成 nil 会让一次
/// 真实的启动失败在界面上表现成什么都没发生。故障本身也写进详情——排查方向由此分得清是
/// 「引擎报了错」还是「诊断通道自己坏了」。
private func unreadableDiagnosis(_ read: DiagnosticRead, file: String) -> EngineError? {
    guard case .unreadable(let reason) = read else { return nil }
    return EngineError(token: startFailedGeneric, detail: "\(file) diagnostic unreadable: \(reason)")
}

/// 预算沿上**唯一确定的失败**——系统收下了启动请求却从没推进这次会话。
///
/// 判据是 `sessionEverLeftDisconnected`：从未离开断开态 = 系统没去拉隧道进程（扩展注册被
/// 覆盖安装打断、配置未启用、权限被撤都落在这里），用户该做的是重装或检查系统设置。
///
/// **会话已在推进的那一支不在这里**：它压根不判负，预算到点只是不再等了，
/// 结局由会话自己在终止沿发布。故本函数不收 `sessionEverLeftDisconnected`——一个恒为
/// false 的入参不是判据，只是一个等着被传错的洞；也不收 `timeoutSeconds` 与前两级诊断：
/// 隧道进程根本没跑起来，它没写过任何东西，而「等了多久」对这一支没有解释力。
///
/// - Parameter systemDetail: 诊断阶梯第 3 级，系统给出的断开原因（带域与码）。这一支上它
///   按构造即属本次尝试——隧道并没有活着，取到的不可能是别人的。
public func startNeverBeganDiagnosis(systemDetail: String?) -> EngineError {
    let headline = [
        "the system accepted the start request but never began the session",
        "the tunnel extension was never launched — this is not an engine failure",
        "reinstall the app (an interrupted update leaves the extension unregistered)",
        "check that the VPN configuration is enabled in system settings",
    ]
    return EngineError(
        token: startFailedGeneric,
        detail: DiagnosisDetail.join(headline + [systemDetail])
    )
}

/// 一次真实尝试失败、而诊断所在处不可达时的详情：失败由尝试本身确定，这里只交代真因为何缺席。
/// 没有尝试时（挂载读上次结局）不可达只意味着结局未知，不得调用本函数造出一次失败。
public func startDiagnosisUnreachable(reason: String) -> EngineError {
    EngineError(token: startFailedGeneric, detail: "start diagnosis unreachable: \(reason)")
}

private let startFailedGeneric = "START_FAILED_GENERIC"
