import Core
import Foundation
import NetworkExtension

/// 一次启动失败的三件事（诊断 / 时刻 / 来源），**必须同源**：三件事各写一遍同一个判别式，
/// 就会有一天只改两遍，屏上变成「时刻取自这次失败、来源取自上一次」。
/// 故把「哪一份说了算」收成**一次**决定：整组一起选，要么全取本地那份，要么全取回落那份。
struct FailureAttribution: Equatable {
    let error: EngineError?
    let occurredAt: Date?
    let source: FailureSource?

    static let none = FailureAttribution(error: nil, occurredAt: nil, source: nil)

    /// 本进程自己判定的那一份（启动预算到点、合并失败）⇒ 来源**恒为** `.app`。
    ///
    /// 来源不由调用方传：这个工厂存在的意义就是「本地登记」与 `.app` 绑死，
    /// 让它变成一个传参就是把刚收拢的决定又散回去。
    static func local(_ error: EngineError?, at occurredAt: Date?) -> FailureAttribution {
        guard let error else { return .none }
        return FailureAttribution(error: error, occurredAt: occurredAt, source: .app)
    }

    /// 系统把这次拉起打回了（诊断阶梯第 3 级）⇒ 来源**恒为** `.system`。
    ///
    /// 与 `local` 并列而不是给它加一个参数：**两个工厂各自把来源绑死，调用点选哪一个就是它表的态**
    /// ⇒ 决定仍然只发生一次，只是从一个点变成两个点。加参数则是把刚收拢的决定又散回调用方。
    static func systemRefused(_ error: EngineError?, at occurredAt: Date?) -> FailureAttribution {
        guard let error else { return .none }
        return FailureAttribution(error: error, occurredAt: occurredAt, source: .system)
    }

    /// 「这次失败是不是系统给的」——**判别式只此一处**，两个调用点共用。
    ///
    /// **判据是「域」，不是一张手挑的码表**：系统错误带域与码，**域回答「这是不是系统给的」，
    /// 码是载荷**；手挑一组码就是替产品做决定。
    ///
    /// 用**动态类型**判，理由同 `describe(_:)`：`as? NSError` 对每个 Swift 错误都成功
    /// （隐式桥接），拿它当判据会把本仓自己的错误也判成系统给的。
    static func isSystemRefusal(_ failure: Error) -> Bool {
        if case .systemRefused = failure as? StartFailure { return true }
        guard type(of: failure) is NSError.Type else { return false }
        return (failure as NSError).domain == NEVPNErrorDomain
    }

    /// **整组回落**：本地没登记就整组取 `fallback`，不许三行各挑各的。
    ///
    /// 判别式是 `error` 而不是 `source`：没有诊断就没有失败，而来源可以缺（没记下 ⇒ 占位）。
    func orElse(_ fallback: FailureAttribution) -> FailureAttribution {
        error != nil ? self : fallback
    }
}

/// 启动路径已经归好类的失败：诊断带着自己的 token 与来源走到登记处。
///
/// 登记处若对它再 `describe` 一遍、包一层 GENERIC，专门的 token 就在最后一步被抹平——
/// 归类做得再细，屏上也永远只有一种失败。
enum StartFailure: Error, CustomStringConvertible {
    case local(EngineError)
    /// 系统把这次拉起打回了，诊断已据系统给的原因归类。
    case systemRefused(EngineError)

    var diagnosis: EngineError {
        switch self {
        case .local(let diagnosis), .systemRefused(let diagnosis): diagnosis
        }
    }

    var description: String { diagnosis.detail ?? diagnosis.token }

    /// 登记处的唯一取法：已归类的原样取出，其余错误才包成 GENERIC。
    static func diagnosis(of failure: Error) -> EngineError {
        (failure as? StartFailure)?.diagnosis
            ?? EngineError(token: "START_FAILED_GENERIC", detail: describe(failure))
    }
}
