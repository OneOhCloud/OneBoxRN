import Foundation
import Core

// 观察数据出口（随 UDS 观察通道接线）：未装通道时只更新快照、不外发。
protocol ObservationSink: AnyObject {
    func emitTraffic(_ traffic: Traffic)
    func emitGroups(_ groups: [NodeGroup])
    func emitLog(_ line: LogLine)
    func emitSessionStats(_ stats: SessionStats)
}

// UI 反向命令出口（随 handleAppMessage 接线）：把中立命令落到引擎命令通道。
protocol HubCommandSink: AnyObject {
    func selectOutbound(groupTag: String, outboundTag: String)
    func urlTest(groupTag: String)
}

// 引擎观察枢纽（:tun 进程单例，镜像 Android tunnel/MonitorHub）：引擎观察回调在此汇聚成
// 最近快照并转发给观察通道。存在的理由是解耦「引擎 start 时机」与「UI 连上通道的时机」——
// UI 晚连仍能取到最近快照，无需内核重推。
//
// 内存纪律：只保最近一份 traffic/groups 快照，日志只转发不缓存——桥不建用户态增长队列。
final class MonitorHub: @unchecked Sendable {
    static let shared = MonitorHub()

    private let lock = NSLock()
    private var observationSink: ObservationSink?
    private var commandSink: HubCommandSink?

    // 用量采样器：装在这里而不是 App 侧——App 挂起后观察通道断流，隧道照常转发流量。
    // 由 PacketTunnelProvider 随启动装入（带本次会话的记账归属）、随停止卸下。
    private var usageRecorder: UsageRecorder?
    private var latestTraffic: Traffic?
    private var latestGroups: [NodeGroup] = []
    private var running = false
    // 会话峰值内存：:tun 进程常驻，App 挂起期照常累积，故为真会话峰值。
    private var peakMemory: Int64 = 0
    // 会话统计同理：只有这里的窗口在 App 挂起期间不断档，App 收到后整份替换。
    private var sessionStats = SessionStats(startedAtMillis: MonotonicClock.millis())

    private init() {}

    // MARK: - 装配

    func installObservationSink(_ sink: ObservationSink?) {
        lock.lock()
        defer { lock.unlock() }
        observationSink = sink
    }

    func installCommandSink(_ sink: HubCommandSink?) {
        lock.lock()
        defer { lock.unlock() }
        commandSink = sink
    }

    /// 装入本次会话的用量采样器；未归属会话传 nil，即不记账。
    func installUsageRecorder(_ recorder: UsageRecorder?) {
        lock.lock()
        let previous = usageRecorder
        usageRecorder = recorder
        lock.unlock()
        previous?.close()
    }

    /// 停止沿：补提交剩余待提交量并卸下。
    func closeUsageRecorder() {
        installUsageRecorder(nil)
    }

    /// 休眠沿：只补提交、不卸下（醒来后同一会话继续记账）。
    func flushUsageRecorder() {
        lock.lock()
        let recorder = usageRecorder
        lock.unlock()
        recorder?.flush()
    }

    // per-start 重置：不让上一次运行的快照泄漏进新会话。
    // 重载窗口：换引擎期间抑制「停了一下」的观察语义——保留运行标志与最后一帧快照，
    // 由新引擎的首帧接管。窗口只影响 reset() 的清空面，不影响任何推送路径。
    private var reloading = false

    func beginReload() {
        lock.lock()
        defer { lock.unlock() }
        reloading = true
    }

    func endReload() {
        lock.lock()
        defer { lock.unlock() }
        reloading = false
    }

    func reset() {
        lock.lock()
        defer { lock.unlock() }
        // 会话峰值恒随引擎实例归零（一次 start 到 stop 为一个会话），重载也不例外。
        peakMemory = 0
        commandSink = nil
        // 一并卸观察出口：停止后释放其 socket fd，不留到下次 start。
        observationSink = nil
        // 重载窗口内保留运行标志与最后一帧：那两样正是「用户不该看见这次换引擎」的落点。
        if reloading { return }
        latestTraffic = nil
        latestGroups = []
        running = false
        sessionStats = SessionStats(startedAtMillis: MonotonicClock.millis())
    }

    // 运行标志权威由绑定的 start/stop 驱动。
    func setRunning(_ state: MonitorRunningState) {
        lock.lock()
        defer { lock.unlock() }
        running = state == .running
    }

    // MARK: - 引擎 → 桥

    func pushTraffic(_ traffic: Traffic) {
        lock.lock()
        // 峰值在枢纽盖章（负值 clamp，格式化层对负值 fail-fast），绑定映射保持无损透传。
        peakMemory = max(peakMemory, max(traffic.memory, 0))
        let stamped = Traffic(
            up: traffic.up,
            down: traffic.down,
            upTotal: traffic.upTotal,
            downTotal: traffic.downTotal,
            memory: traffic.memory,
            memoryPeak: peakMemory,
            connIn: traffic.connIn,
            connOut: traffic.connOut
        )
        latestTraffic = stamped
        // 时刻在锁内读：追加与读时钟同处一个串行域，窗口的「时刻不得倒退」天然成立。
        sessionStats = sessionStats.appending(atMillis: MonotonicClock.millis(), traffic: stamped)
        let stats = sessionStats
        let sink = observationSink
        let recorder = usageRecorder
        lock.unlock()
        // 记账只做锁内算术，IO 在采样器自己的串行队列上（数据面不做 IO）。
        recorder?.observe(stamped)
        sink?.emitTraffic(stamped)
        sink?.emitSessionStats(stats)
    }

    func pushGroups(_ groups: [NodeGroup]) {
        lock.lock()
        latestGroups = groups
        let sink = observationSink
        lock.unlock()
        sink?.emitGroups(groups)
    }

    // 日志只转发不缓存：UI 晚连不回放历史（观察桥不承担日志存储）。
    func pushLog(_ line: LogLine) {
        lock.lock()
        let sink = observationSink
        lock.unlock()
        sink?.emitLog(line)
    }

    // MARK: - UI 挂载回放

    /// UI 连上通道时取最近快照，免等下一次内核推送。
    func snapshot() -> (traffic: Traffic?, groups: [NodeGroup], running: Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (latestTraffic, latestGroups, running)
    }

    // MARK: - UI → 引擎（反向命令）

    /// 中立契约只给节点 tag，引擎要 (groupTag, outboundTag)——按最近 groups 反查所属组。
    func selectNode(tag: String) {
        lock.lock()
        let groups = latestGroups
        let sink = commandSink
        lock.unlock()
        guard let group = groups.first(where: { $0.nodes.contains { $0.tag == tag } }) else { return }
        sink?.selectOutbound(groupTag: group.tag, outboundTag: tag)
    }

    func urlTest(tag: String) {
        lock.lock()
        let sink = commandSink
        lock.unlock()
        sink?.urlTest(groupTag: tag)
    }
}

enum MonitorRunningState {
    case running
    case stopped
}
