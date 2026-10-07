package cloud.oneoh.oneboxn.core

// 配置变更的隧道处置判定。两端逐字对应，golden `config-change.json` 裁判。
//
// 放在 core 而不是各端动作层：判据一旦各写一份，「已连接时改配置该不该动隧道」就会在两端
// 慢慢分叉——而那种分叉只在真机上、只在某个相位组合下现形，代价远高于一份夹具。

/** 变更种类:决定这次改动要不要动隧道、怎么动。 */
enum class ConfigChange {
    /** 改的是引擎当场就能吃下的字节:激活 profile / 路由模式 / 规则 / 选核。 */
    ENGINE_CONFIG,

    /**
     * 高级设置及其子页(内核参数、网络包含范围):只落盘,生效于用户下一次手动启动。
     *
     * 答的是**结局**(这个值下一轮启动才被读取),不是**载体**——同一类里既有引擎字节也有
     * `NEVPNProtocol` 属性,载体各自的持久化处不同,与本判定无关。
     */
    NEXT_START_ONLY,
}

/** 归一后的会话相位:两端各自可得的真相(OS 连接 + 引擎阶段)折成同一个三值。 */
enum class TunnelSessionPhase { NOT_RUNNING, STARTING, RUNNING }

/** 处置:对隧道做什么。 */
enum class ConfigChangeDisposition { NONE, RELOAD, RESTART }

/**
 * 会话相位归一(处置判定的第 1 步)。
 *
 * **两个输入都要**:连接真相的权威是 OS,而引擎阶段来自观察通道、可能滞后。
 * 只收引擎阶段会让「OS 已连接但引擎阶段还没跟上」那一拍的配置变更被整个跳过。
 *
 * `STOPPING` 压过 `osConnected`:停止已在飞,此刻只该落盘;OS 那边的 connected 还没落下来
 * 是滞后,不是「在跑」。
 */
fun sessionPhase(osConnected: Boolean, engineStatus: EngineStatus): TunnelSessionPhase = when {
    engineStatus == EngineStatus.STOPPING -> TunnelSessionPhase.NOT_RUNNING
    osConnected || engineStatus == EngineStatus.STARTED -> TunnelSessionPhase.RUNNING
    engineStatus == EngineStatus.STARTING -> TunnelSessionPhase.STARTING
    else -> TunnelSessionPhase.NOT_RUNNING
}

/**
 * 处置判定(第 2 步)。
 *
 * `NEXT_START_ONLY` **先于相位判定**:该类变更恒不动隧道,相位不参与。
 * `STARTING` 只能走完整重启:那一刻还没有可换的引擎实例。
 */
fun configChangeDisposition(
    phase: TunnelSessionPhase,
    change: ConfigChange,
): ConfigChangeDisposition = when {
    change == ConfigChange.NEXT_START_ONLY -> ConfigChangeDisposition.NONE
    phase == TunnelSessionPhase.NOT_RUNNING -> ConfigChangeDisposition.NONE
    phase == TunnelSessionPhase.STARTING -> ConfigChangeDisposition.RESTART
    else -> ConfigChangeDisposition.RELOAD
}
