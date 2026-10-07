import Foundation

/// 一次发送失败的归类：发送端据此维护「对端可达」信念。
public enum ObservationDelivery: Equatable, Sendable {
    case peerAbsent
    case congested

    /// 路径端点上对端不在是 ENOENT / ECONNREFUSED；ECONNRESET / EPIPE / ENOTCONN 同样说明对端已不在。
    /// 其余（缓冲满等）都只是拥塞。
    public static func classify(errorCode: Int32) -> ObservationDelivery {
        switch errorCode {
        case ENOENT, ECONNREFUSED, ECONNRESET, EPIPE, ENOTCONN: return .peerAbsent
        default: return .congested
        }
    }
}
