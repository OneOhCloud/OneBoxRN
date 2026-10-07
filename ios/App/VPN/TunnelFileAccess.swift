import Foundation
import Core

/// App 侧跨进程文件的唯一出处：直接落共享容器。
enum TunnelFileAccess {
    static var current: any TunnelFiles {
        ContainerTunnelFiles(base: AppGroupPaths.baseDirectory())
    }
}
