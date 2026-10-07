import Foundation
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools", category: "Observation")

/// 建端点失败的类型化原因。
///
/// 不用 `init?` 返回 nil：调用方必须能分辨「另一个活实例占着」与「系统调用真的失败了」——
/// 前者是正常且预期的（第二实例本就不该接管观察面），后者要留证排查。
enum ObservationEndpointFailure: Error, CustomStringConvertible {
    /// 端点路径超出 `sun_path` 容量。宁可不接观察通道，也不静默截断成错误路径。
    case pathTooLong(path: String, bytes: Int)
    /// 所有权锁被另一个活实例持有。
    case busy(diagnosis: String)
    case systemCall(call: String, errorCode: Int32)

    var description: String {
        switch self {
        case .pathTooLong(let path, let bytes):
            return "observation endpoint path too long: \(bytes) bytes (\(path))"
        case .busy(let diagnosis):
            return "observation endpoint owned by another live instance (\(diagnosis))"
        case .systemCall(let call, let errorCode):
            return "observation endpoint \(call) failed: \(String(cString: strerror(errorCode)))"
        }
    }
}

/// 端点当前形态。**只作诊断**，不参与所有权决策（探测与 bind 之间没有原子性）。
enum ObservationEndpointProbe: String {
    /// 路径不存在。
    case vacant
    /// 路径在但无人 bind —— 上次进程留下的残骸。
    case stale
    /// 有 socket 正在监听该路径。
    case listening
    /// 探测本身失败，说不出形态。
    case indeterminate
}

/// 端点身份：bind 时记下，供读循环判「路径是否仍指向我这个 socket」。
///
/// 该比对**只用于发现失窃，不用于授权删除**——`lstat → unlink` 之间有 TOCTOU 窗口，
/// 删除权只归持锁者。
struct ObservationEndpointIdentity: Sendable, Equatable {
    let device: dev_t
    let inode: ino_t

    /// 读取路径当前身份；路径不存在或不是 socket 均返回 nil（两者都算「不再是我的端点」）。
    static func read(path: String) -> ObservationEndpointIdentity? {
        var metadata = stat()
        guard path.withCString({ Darwin.lstat($0, &metadata) }) == 0 else { return nil }
        // 校验类型：路径被换成普通文件同样是「端点没了」，不能只比 inode。
        guard (metadata.st_mode & S_IFMT) == S_IFSOCK else { return nil }
        return ObservationEndpointIdentity(device: metadata.st_dev, inode: metadata.st_ino)
    }
}

/// 端点所有权：一把 App Group 内的排他锁 + 它所授权的一个已绑定 socket。
///
/// 为什么是锁而不是「探测后删除」：`bind()` 到已存在的 `sun_path` 恒返回 `EADDRINUSE`，
/// 区分不了残骸与活实例；而「先探测再决定删不删」的探测与 bind 之间没有原子性——两个新实例
/// 同时冷启动会双双判「残骸」、各自 unlink 后 bind，后者把前者变成孤儿，观察通道就此永久定格。
/// 锁的获取是原子的，且由内核在 fd 关闭时释放，
/// 进程崩溃退出同样释放。
///
/// **两个资源的回收者不同,故拆成两个动作**:所有权(路径 + 锁)必须能在挂起沿由
/// 调用线程**同步**交还——iOS 挂起时仍持有共享容器内的文件锁,RunningBoard 一律 `SIGKILL`
/// (`0xdead10cc`);而 socket fd 只有读循环知道自己何时不再 `poll` 它。把交还绑在读线程的
/// 进度上,就是把一条硬约束交给一个没有上界的等待(读线程可能正卡在一次投递里)。
/// 两个动作各自幂等,谁先到谁生效。
final class ObservationEndpointOwnership: ObservationReceiveEndpoint, @unchecked Sendable {
    let socketDescriptor: Int32
    let socketUrl: URL
    let identity: ObservationEndpointIdentity

    /// 回收状态。两个 fd 各自一次性关闭——重复 `close` 会关掉别人刚拿到的同号 fd。
    private let teardownLock = NSLock()
    private var lockDescriptor: Int32?
    private var socketClosed = false

    private init(
        lockDescriptor: Int32,
        socketDescriptor: Int32,
        socketUrl: URL,
        identity: ObservationEndpointIdentity
    ) {
        self.lockDescriptor = lockDescriptor
        self.socketDescriptor = socketDescriptor
        self.socketUrl = socketUrl
        self.identity = identity
    }

    /// 取得所有权并绑定端点。失败时内部资源已全部回收，调用方无需善后。
    ///
    /// - Throws: `ObservationEndpointFailure.busy` 表示另一个活实例持有所有权 —— 这是预期结局，
    ///   不是缺陷；本实例本次会话没有观察数据才是如实的。
    static func claim(baseDirectory: URL) throws -> ObservationEndpointOwnership {
        let socketUrl = baseDirectory.appendingPathComponent(ObservationEndpoint.socketName)
        let lockUrl = baseDirectory.appendingPathComponent(ObservationEndpoint.lockName)
        guard var address = makeAddress(path: socketUrl.path) else {
            throw ObservationEndpointFailure.pathTooLong(
                path: socketUrl.path,
                bytes: socketUrl.path.utf8.count
            )
        }

        let lockDescriptor = try acquireLock(at: lockUrl, socketPath: socketUrl.path)
        do {
            // 持锁之后才动路径：未持锁者一律不删，连「看起来是残骸」也不删。
            // bind 因 EADDRINUSE 失败恰恰说明路径归别人，删掉就是删了别人的端点。
            try? FileManager.default.removeItem(at: socketUrl)

            let descriptor = socket(AF_UNIX, SOCK_DGRAM, 0)
            guard descriptor >= 0 else {
                throw ObservationEndpointFailure.systemCall(call: "socket", errorCode: errno)
            }
            do {
                try configureReceiveBuffer(descriptor)
                let bound = withUnsafePointer(to: &address) { pointer -> Int32 in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addr in
                        bind(descriptor, addr, socklen_t(MemoryLayout<sockaddr_un>.size))
                    }
                }
                guard bound == 0 else {
                    throw ObservationEndpointFailure.systemCall(call: "bind", errorCode: errno)
                }
                guard let identity = ObservationEndpointIdentity.read(path: socketUrl.path) else {
                    let code = errno
                    // 已经 bind 出来的路径要一并摘掉：留着它就是下一次 claim 要清的残骸，
                    // 而失败路径本就该把自己造出来的东西收干净。
                    _ = socketUrl.path.withCString { Darwin.unlink($0) }
                    throw ObservationEndpointFailure.systemCall(call: "lstat", errorCode: code)
                }
                return ObservationEndpointOwnership(
                    lockDescriptor: lockDescriptor,
                    socketDescriptor: descriptor,
                    socketUrl: socketUrl,
                    identity: identity
                )
            } catch {
                Darwin.close(descriptor)
                throw error
            }
        } catch {
            // 锁随失败一并释放：留着它会把本进程自己挡在下一次重建之外。
            Darwin.close(lockDescriptor)
            throw error
        }
    }

    /// 交还所有权：**摘名 → 解锁**。幂等，可由任意线程调用（挂起沿要求同步交还）。
    ///
    /// 次序不可颠倒。**必须在持锁期间摘名**：先解锁的话，下一个实例会在路径还指着我这个 inode
    /// 时拿到锁并建自己的端点，而我随后那次「身份仍是我的吗」的比对与 unlink 之间有窗口——
    /// 比对通过后对方替换了路径，我删掉的就是**它**的端点。持锁期间对方进不来，窗口不存在。
    ///
    /// socket fd 不在这里关：交还之后它只是一个收不到东西的匿名 socket，读循环照常收完在途
    /// datagram 再自行退出。
    func releaseOwnership() {
        teardownLock.lock()
        guard let descriptor = lockDescriptor else {
            teardownLock.unlock()
            return
        }
        lockDescriptor = nil
        teardownLock.unlock()

        unlinkSocketIfStillMine()
        Darwin.close(descriptor)
    }

    /// 关数据 fd。只由读循环在退出时调——只有它知道自己何时不再 `poll` / `recvfrom` 这个 fd。
    func closeSocket() {
        teardownLock.lock()
        let alreadyClosed = socketClosed
        socketClosed = true
        teardownLock.unlock()
        guard !alreadyClosed else { return }
        Darwin.close(socketDescriptor)
    }

    /// 整体回收：交还所有权 + 关数据 fd。用于「读循环已退出」与「压根没起读循环」两处收尾。
    func release() {
        closeSocket()
        releaseOwnership()
    }

    func lossDetail() -> String? {
        guard let current = ObservationEndpointIdentity.read(path: socketUrl.path) else {
            return "path missing or no longer a socket"
        }
        guard current == identity else {
            return "path rebound by another instance (inode \(identity.inode) → \(current.inode))"
        }
        return nil
    }

    /// 只删仍指向自己的那个端点。持锁期间别人本就动不了它，这里是纵深防御而非授权依据。
    private func unlinkSocketIfStillMine() {
        guard ObservationEndpointIdentity.read(path: socketUrl.path) == identity else { return }
        _ = socketUrl.path.withCString { Darwin.unlink($0) }
    }

    private static func acquireLock(at lockUrl: URL, socketPath: String) throws -> Int32 {
        let descriptor = lockUrl.path.withCString { open($0, O_CREAT | O_RDWR, 0o644) }
        guard descriptor >= 0 else {
            throw ObservationEndpointFailure.systemCall(call: "open(lock)", errorCode: errno)
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno
            Darwin.close(descriptor)
            guard code == EWOULDBLOCK else {
                throw ObservationEndpointFailure.systemCall(call: "flock", errorCode: code)
            }
            // 被占用时补一次形态探测：它进不了所有权决策，但能让日志说清「对面是活的还是残骸」。
            throw ObservationEndpointFailure.busy(diagnosis: probe(socketPath: socketPath).rawValue)
        }
        return descriptor
    }

    /// 端点形态探测（**仅诊断**）。
    ///
    /// Darwin 上：路径不存在 → `ENOENT`；残骸（bind 过、已关闭、未 unlink）→
    /// `ECONNREFUSED`；活实例 → 成功；**活实例且接收缓冲已灌满 → 仍成功**（拥塞不会被误读成「没人」）。
    static func probe(socketPath: String) -> ObservationEndpointProbe {
        guard var address = makeAddress(path: socketPath) else { return .indeterminate }
        let descriptor = socket(AF_UNIX, SOCK_DGRAM, 0)
        guard descriptor >= 0 else { return .indeterminate }
        defer { Darwin.close(descriptor) }
        let connected = withUnsafePointer(to: &address) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addr in
                connect(descriptor, addr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if connected == 0 { return .listening }
        switch errno {
        case ENOENT: return .vacant
        case ECONNREFUSED: return .stale
        default: return .indeterminate
        }
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

    /// 接收缓冲不足即拒绝建通道：容量不够时洪峰期会大面积丢帧，那比没有观察数据更难排查。
    private static func configureReceiveBuffer(_ descriptor: Int32) throws {
        var requestedBytes = Int32(ObservationFrameCodec.requiredReceiveBufferBytes)
        guard setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_RCVBUF,
            &requestedBytes,
            socklen_t(MemoryLayout<Int32>.size)
        ) == 0 else {
            throw ObservationEndpointFailure.systemCall(call: "setsockopt(SO_RCVBUF)", errorCode: errno)
        }

        var actualBytes = Int32.zero
        var valueBytes = socklen_t(MemoryLayout<Int32>.size)
        guard getsockopt(descriptor, SOL_SOCKET, SO_RCVBUF, &actualBytes, &valueBytes) == 0 else {
            throw ObservationEndpointFailure.systemCall(call: "getsockopt(SO_RCVBUF)", errorCode: errno)
        }
        guard actualBytes >= requestedBytes else {
            logger.error("observation receive buffer too small: \(actualBytes, privacy: .public)")
            throw ObservationEndpointFailure.systemCall(call: "SO_RCVBUF", errorCode: ENOBUFS)
        }
    }
}
