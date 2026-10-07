import Foundation
import Core

// 竞速执行器（镜像 Android net/DnsRace.kt）：全部候选并发 UDP 探测，首个可接受响应者
// 胜出即解除调用方等待；入口总限时 500ms（哨兵），零响应返回 nil（回落合并的 DNS 取值链）。
// 纯件（候选表/构包/判定）唯一出处 = core DnsProbe。
enum DnsRace {
    private enum Outcome {
        case winner(String)
        case miss
        case deadline
    }

    /// 竞速体跑独立任务，阻塞 socket 收发隔离在 GCD，绝不落 Swift 协作线程池；
    /// 调用方在首个胜者 / 500ms 哨兵 / 全部落空三者最先到达时被解除等待，
    /// 组内落伍探测经 SO_RCVTIMEO 在后台自行收尾（结构化并发无法提前逃逸，故经 continuation 解耦）。
    static func race() async -> String? {
        await withCheckedContinuation { continuation in
            let once = ResumeOnce(continuation)
            Task.detached(priority: .userInitiated) {
                await withTaskGroup(of: Outcome.self) { group in
                    for server in DnsProbe.SERVERS {
                        group.addTask { await probe(server) ? .winner(server) : .miss }
                    }
                    // 入口总限时哨兵：到点即以零响应结局解除等待。
                    group.addTask {
                        try? await Task.sleep(for: .milliseconds(DnsProbe.TIMEOUT_MS))
                        return .deadline
                    }
                    var misses = 0
                    for await outcome in group {
                        switch outcome {
                        case .winner(let server):
                            once.resume(server)
                            group.cancelAll()
                            return
                        case .deadline:
                            once.resume(nil)
                            group.cancelAll()
                            return
                        case .miss:
                            misses += 1
                            if misses == DnsProbe.SERVERS.count {
                                once.resume(nil)
                                group.cancelAll()
                                return
                            }
                        }
                    }
                }
            }
        }
    }

    // 单路探测：阻塞收发放 GCD 全局队列，经 continuation 回到并发世界；
    // blockingProbe 必然有界返回（SO_RCVTIMEO），单次 resume 由线性路径保证。
    private static func probe(_ server: String) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: blockingProbe(server))
            }
        }
    }

    // BSD socket 探测（照搬参考实现骨架）：IO 失败等同该路无响应（这是预期结局，非吞错）。
    private static func blockingProbe(_ server: String) -> Bool {
        let socketFD = socket(AF_INET, SOCK_DGRAM, 0)
        guard socketFD >= 0 else { return false }
        defer { close(socketFD) }

        // SO_RCVTIMEO 450ms：任务取消无法中断阻塞 recv，这是 GCD 线程释放的唯一保障，不可省。
        var timeout = timeval(tv_sec: 0, tv_usec: 450_000)
        setsockopt(socketFD, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = UInt16(DnsProbe.PORT).bigEndian
        guard inet_pton(AF_INET, server, &address.sin_addr) == 1 else { return false }

        let query = DnsProbe.queryBytes()
        let sent = query.withUnsafeBytes { bytes in
            withUnsafePointer(to: &address) { addressPointer in
                addressPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                    sendto(socketFD, bytes.baseAddress, query.count, 0, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        guard sent > 0 else { return false }

        var buffer = [UInt8](repeating: 0, count: 512)
        let received = recv(socketFD, &buffer, buffer.count, 0)
        guard received > 0 else { return false }
        return DnsProbe.isAcceptable(Array(buffer.prefix(received)))
    }

    // 单次 resume 守卫：胜者 / 哨兵 / 全部落空三条路径可能竞争同一 continuation，先到者生效。
    private final class ResumeOnce: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<String?, Never>?

        init(_ continuation: CheckedContinuation<String?, Never>) {
            self.continuation = continuation
        }

        func resume(_ value: String?) {
            lock.lock()
            let pending = continuation
            continuation = nil
            lock.unlock()
            pending?.resume(returning: value)
        }
    }
}
