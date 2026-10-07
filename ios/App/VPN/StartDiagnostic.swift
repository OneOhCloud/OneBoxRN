import Foundation
import Core

// 启动诊断读取（UI 侧，provider 写、经 `TunnelFiles` 取）。
//
// 本文件只做一件事：把诊断阶梯前两级的两份文件**如实**搬成 `DiagnosticRead`。
// 「搬到的东西意味着什么」归 core `startDiagnosis`——写的是隧道扩展、读的是 App，两侧各解释
// 一遍迟早分叉，且那里是纯逻辑、可被单测钉住。
// 第 3 级（系统拒绝拉起 provider，两个文件都不存在）不在这里：那是 VPN 层的真相，
// 见 `TunnelController.lastDisconnectError()`。
enum StartDiagnostic {
    /// - Throws: `TunnelFilesError.unavailable`——读取根本没有发生：文件在不在、写了什么都不知道。
    ///   它既不是「没有失败」也不是「诊断坏了」，归不进 `DiagnosticRead` 的任何一态，交调用方按场合定夺。
    static func read(files: any TunnelFiles) throws -> EngineError? {
        startDiagnosis(error: try read(.startError, in: files), stage: try read(.startStage, in: files))
    }

    /// 用户主动断开时把两份文件清掉。
    ///
    /// 写侧是隧道扩展、清侧是 App——本来该由独占写者去清，但用户按下停止时扩展多半已经不在了，
    /// 没有任何时机能让它自己清。此处清的是**上一段已经结束**的诊断，与扩展的写入不并发。
    /// - Returns: 清理过程中的失败描述，全成功则空。调用方 MUST 落日志,不得静默。
    static func clear(files: any TunnelFiles) -> [String] {
        [TunnelFile.startError, .startStage].compactMap { remove($0, in: files) }
    }

    private static func remove(_ file: TunnelFile, in files: any TunnelFiles) -> String? {
        do {
            try files.remove(file)
            return nil
        } catch {
            return "\(file.relativePath): \(describe(error))"
        }
    }

    /// **读不出来不折成「没有」**：`try?` 把「文件在却读不出来」与「本次没有失败」压成同一个空串，
    /// 而这条通道是 UI 唯一能问到引擎真因的地方——压掉之后一次真实的启动失败在界面上表现成
    /// 什么都没发生。三态原样交给 core 判定。
    private static func read(_ file: TunnelFile, in files: any TunnelFiles) throws -> DiagnosticRead {
        do {
            guard let data = try files.read(file) else { return .absent }
            guard let text = String(data: data, encoding: .utf8) else {
                return .unreadable("\(file.relativePath): not UTF-8")
            }
            return .text(text)
        } catch TunnelFilesError.unavailable(let detail) {
            throw TunnelFilesError.unavailable(detail)
        } catch {
            return .unreadable(describe(error))
        }
    }
}

/// 热重载失败的诊断合成：诊断在写入时合成，不在读取时择优。
///
/// 存在的理由：`responseMissing` / 超时这类传输层错误只说明「结局未知」，是全链路里信息量最低
/// 的一句；直接把它写成 `lastError` 会把隧道进程写下的真因整个挡在后面——用户复制走的诊断于是
/// 只剩一句 `detail: responseMissing`，排查无从起步。
///
/// - Parameters:
///   - transportError: 收口处拿到的错误。已经是 `EngineError` 即表示隧道进程把结局送到了。
///   - tunnelDiagnosis: 隧道进程自己写下的诊断（诊断阶梯前两级，来自 `StartDiagnostic`）。
///     **第 3 级（系统断开原因）有意不参与**：它只在「本次尝试被打回」那一沿属于本次，
///     而重载失败时隧道可能还活着，取到的会是上一次会话的原因。
func reloadDiagnosis(transportError: Error, tunnelDiagnosis: EngineError?) -> EngineError {
    if let reported = transportError as? EngineError { return reported }
    // 传输层错误常是系统 NSError（`NEVPNErrorDomain code=5` 之类）：诊断要带域与码，
    // 而 `String(describing:)` 会把整个 userInfo 一并倒出来、`localizedDescription` 又只剩一句
    // 随系统语言变的文本。两头都不合用，故统一走 core 的 `describe`。
    let detail = [tunnelDiagnosis?.detail, describe(transportError)]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: " — ")
    return EngineError(token: "RELOAD_FAILED", detail: detail)
}
