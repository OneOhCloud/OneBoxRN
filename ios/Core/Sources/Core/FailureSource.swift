import Foundation

/// 失败诊断的来源。
///
/// **由登记方在写入时记下，呈现侧只读不猜。** 诊断阶梯的四级里只有第 1 级是引擎：
/// 第 2 级是隧道进程留下的痕迹（引擎并没说话）、第 3 级是操作系统、超时/合并失败/授权缺失
/// 都是 App 自己的判定。呈现侧一猜，「App 等了 20 秒不等了」这种失败就会被标成引擎报的，
/// 用户会按那一行去查一个没有问题的引擎。
///
/// 没记下时**不得回落到任何一个具体来源**：按弹层 MetaRow 的既有规则占位「—」，不编造。
public enum FailureSource: String, Sendable, CaseIterable {
    /// 引擎自己报的（阶梯第 1 级，或运行期经观察通道推来的失败）。
    case engine
    /// 隧道进程留下的痕迹，但引擎没说话（阶梯第 2 级：阶段标记）。
    case tunnel
    /// 本进程自己的判定：启动预算到点、合并失败、缺授权。
    case app
    /// 操作系统给的（阶梯第 3 级，带域与码）。
    case system
    /// 诊断通道自己坏了——既不是原因也不是阶段，而是「问不出来」。
    case diagnostics

    public var token: String { rawValue }

    public static func fromToken(_ token: String) -> FailureSource? {
        allCases.first { $0.token == token }
    }
}
