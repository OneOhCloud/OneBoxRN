import Foundation
import Core

/// 观察通道接收端的契约：读循环只认这一层，端点的 bind 与所有权锁归实现方（`ObservationEndpointOwnership`）。
protocol ObservationReceiveEndpoint: AnyObject, Sendable {
    var socketDescriptor: Int32 { get }
    /// 端点是否已不再归本端；nil = 仍是自己的。只发现失窃，不授权删除。
    func lossDetail() -> String?
    /// 交还所有权（挂起沿要求在调用线程上同步完成）。幂等。
    func releaseOwnership()
    /// 整体回收：交还所有权 + 关数据 fd。幂等。
    func release()
}

/// 观察绑定取端点与跨进程文件的出处。可注入只为让测试有自己的容器——共用真容器的用例
/// 会因「本机恰好跑着一份真 App」而红，那是环境状态而非缺陷。
struct ObservationChannelSource: Sendable {
    let files: any TunnelFiles
    let openEndpoint: @Sendable () throws -> any ObservationReceiveEndpoint

    static func container(baseDirectory: URL) -> ObservationChannelSource {
        ObservationChannelSource(
            files: ContainerTunnelFiles(base: baseDirectory),
            openEndpoint: { try ObservationEndpointOwnership.claim(baseDirectory: baseDirectory) }
        )
    }

    static var current: ObservationChannelSource {
        return container(baseDirectory: AppGroupPaths.baseDirectory())
    }
}
