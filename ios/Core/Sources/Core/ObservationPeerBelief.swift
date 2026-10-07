// 对端可达信念(iOS 发送端闸)。流量帧是唯一探针——对端缺席类失败置不可达,
// 发送成功置可达;不可达期日志/分组发射整体短路(不攒批、不写快照),流量帧照发。
public enum TrafficSendOutcome: Sendable {
    case sent
    case peerAbsent
    case congested
}

public struct ObservationPeerBelief: Sendable {
    private(set) public var reachable = true

    public init() {}

    /// 流量帧发送结果回执(唯一信念输入;其他帧的结果不动信念,避免闸门自锁)。
    public mutating func onTrafficSend(_ outcome: TrafficSendOutcome) {
        if outcome == .sent {
            reachable = true
        } else if outcome == .peerAbsent {
            reachable = false
        }
        // 失败但非缺席类(如 ENOBUFS 缓冲满):对端在,只是拥塞——信念不变。
    }

    /// 不可达期引擎日志不入攒批环。
    public var shouldBufferLogs: Bool { reachable }

    /// 不可达期分组变更不写快照不发代号(回归后由 UI 快照索取补齐)。
    public var shouldEmitGroups: Bool { reachable }
}
