import Foundation
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.tunnel", category: "Observation")

/// 观察帧的出口：成功返回 nil，失败返回 errno（由发送方归类、限流记录）。
protocol ObservationDatagramOutlet: Sendable {
    func send(_ data: Data) -> Int32?
}

/// iOS 的出口：往 App 在共享容器里 bind 的路径端点发（App 与扩展同一用户、同一容器）。
final class PathDatagramOutlet: ObservationDatagramOutlet, @unchecked Sendable {
    private let fd: Int32
    private let address: sockaddr_un

    /// 端点路径超出 sun_path 容量即返回 nil——宁可不接观察通道，也不静默截断成错误路径。
    init?(socketPath: String) {
        guard let address = Self.makeAddress(path: socketPath) else {
            logger.error("observation socket path too long, channel disabled")
            return nil
        }
        let descriptor = socket(AF_UNIX, SOCK_DGRAM, 0)
        guard descriptor >= 0 else {
            logger.error("observation socket create failed: \(String(cString: strerror(errno)), privacy: .public)")
            return nil
        }
        let flags = fcntl(descriptor, F_GETFL, 0)
        if flags < 0 || fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) < 0 {
            close(descriptor)
            logger.error("observation socket nonblock failed")
            return nil
        }
        self.fd = descriptor
        self.address = address
    }

    deinit {
        close(fd)
    }

    func send(_ data: Data) -> Int32? {
        var target = address
        let sent = withUnsafePointer(to: &target) { pointer -> Int in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addr in
                data.withUnsafeBytes { buffer -> Int in
                    sendto(fd, buffer.baseAddress, buffer.count, 0, addr, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
        }
        return sent < 0 ? errno : nil
    }

    private static func makeAddress(path: String) -> sockaddr_un? {
        let bytes = Array(path.utf8)
        var address = sockaddr_un()
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard bytes.count < capacity, bytes.count < ObservationEndpoint.maxSocketPathBytes else { return nil }
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            raw.copyBytes(from: bytes)
        }
        return address
    }
}
