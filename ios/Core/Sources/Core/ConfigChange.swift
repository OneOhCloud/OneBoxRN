import Foundation

// 配置变更的隧道处置判定。两端逐字对应，golden `config-change.json` 裁判。
//
// 放在 Core 而不是各端动作层：判据一旦各写一份，「已连接时改配置该不该动隧道」就会在两端
// 慢慢分叉——而那种分叉只在真机上、只在某个相位组合下现形，代价远高于一份夹具。

/// 变更种类：决定这次改动要不要动隧道、怎么动。
public enum ConfigChange: Sendable, CaseIterable {
    /// 改的是引擎当场就能吃下的字节：激活 profile / 路由模式 / 规则 / 选核。
    case engineConfig
    /// 高级设置及其子页（引擎参数、网络包含范围）：只落盘，生效于用户下一次手动启动。
    ///
    /// 答的是**结局**（这个值下一轮启动才被读取），不是**载体**——同一类里既有引擎字节也有
    /// `NEVPNProtocol` 属性，载体各自的持久化处不同，与本判定无关。
    case nextStartOnly
}

/// 归一后的会话相位：两端各自可得的真相（OS 连接 + 引擎阶段）折成同一个三值。
public enum TunnelSessionPhase: Sendable, CaseIterable {
    case notRunning
    case starting
    case running
}

/// 处置：对隧道做什么。
public enum ConfigChangeDisposition: Sendable, CaseIterable {
    case none
    case reload
    case restart
}

/// 会话相位归一（处置判定的第 1 步）。
///
/// **两个输入都要**：连接真相的权威是 OS，而引擎阶段来自观察通道、可能滞后。
/// 只收引擎阶段会让「OS 已连接但引擎阶段还没跟上」那一拍的配置变更被整个跳过。
///
/// `.stopping` 压过 `osConnected`：停止已在飞，此刻只该落盘；OS 那边的 connected 还没落下来
/// 是滞后，不是「在跑」。
public func sessionPhase(osConnected: Bool, engineStatus: EngineStatus) -> TunnelSessionPhase {
    if engineStatus == .stopping { return .notRunning }
    if osConnected || engineStatus == .started { return .running }
    if engineStatus == .starting { return .starting }
    return .notRunning
}

/// 处置判定（第 2 步）。
///
/// `.nextStartOnly` **先于相位判定**：该类变更恒不动隧道，相位不参与。
/// `.starting` 只能走完整重启：那一刻还没有可换的引擎实例。
public func configChangeDisposition(
    phase: TunnelSessionPhase,
    change: ConfigChange
) -> ConfigChangeDisposition {
    if change == .nextStartOnly { return .none }
    switch phase {
    case .notRunning:
        return .none
    case .starting:
        return .restart
    case .running:
        return .reload
    }
}
