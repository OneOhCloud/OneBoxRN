/// 节点延迟档位判定。
///
/// 只分档、不定色：档位到语义色的映射属呈现层（色值只出 Theme），
/// 两端 UI 各自把同一档位映射到各自主题。阈值在此处唯一声明。
public enum NodeLatency {

    /// 档位。`none` 是「没有量出数值」，与「很慢」是两回事——呈现上前者是破折号，后者是数值。
    /// rawValue = golden 夹具与日志用的小写 token。
    public enum Tier: String, Sendable {
        case none, good, fair, poor
    }

    /// 良好档上界（含）。
    public static let goodMaxMs = 300

    /// 一般档上界（含）；超出即差档。
    public static let fairMaxMs = 900

    /// 非正数视为无数据——引擎以 0 表示「尚无成功探测样本」，负数不应出现但同样不谎报档位。
    public static func tier(delayMs: Int) -> Tier {
        if delayMs <= 0 { return .none }
        if delayMs <= goodMaxMs { return .good }
        if delayMs <= fairMaxMs { return .fair }
        return .poor
    }
}
