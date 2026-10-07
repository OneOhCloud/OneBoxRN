import Foundation

// 引擎观察通道帧（:tun → UI 单向 datagram）。纯编解码，不含 socket / App Group / 平台调用。
//
// 为什么是有界 datagram + 有界重组：Darwin 的 Unix datagram 上限很小，日志批次必须在
// 应用层分片。接收侧只保留一个最多 48 KiB 的在途批次；慢消费者不会反向制造无界队列。
// 观察通道端点名（App Group 容器内的相对名，:tun 与 UI 两侧必须取同一份）。
// 名字必须短：sockaddr_un.sun_path 仅 104 字节，App Group 容器路径已占去约 90。
public enum ObservationEndpoint {
    public static let socketName = "obs.sock"
    public static let snapshotName = "groups.json"
    /// 端点所有权锁：App Group 容器按 group id 共享，端点路径因此是
    /// 一份跨实例的可变全局状态。谁持有这把排他锁谁才是端点所有者，也只有它可以创建、替换或
    /// 删除端点路径。锁由内核在 fd 关闭时释放（含进程崩溃退出），故不存在「锁没人解」的残骸态。
    public static let lockName = "obs.lock"
    /// sun_path 容量上限，绑定/发送前据此拒绝过长路径而非静默截断。
    public static let maxSocketPathBytes = 104
}

public enum ObservationFrame: Sendable, Equatable {
    case traffic(Traffic)
    case log(LogLine)
    /// groups 快照体积不定，走 App Group 原子文件；本帧只通知"快照已更新"。
    case groupsInvalidation(generation: UInt64)
    /// 会话统计整份推送：App 用它整体替换，不在本地累积。
    case sessionStats(SessionStats)
}

public enum ObservationDatagramDecodeResult: Sendable, Equatable {
    case frames([ObservationFrame])
    case awaitingMore
    case invalid
}

/// 只重组当前一个日志批次；丢片后等下一个起始片，不重试、不增长。
public struct ObservationDatagramDecoder: Sendable {
    private var generation: UInt64?
    private var expectedChunkIndex = 0
    private var chunkCount = 0
    private var payload = Data()

    public init() {}

    public mutating func decode(_ data: Data) -> ObservationDatagramDecodeResult {
        guard let datagram = ObservationFrameCodec.decodeDatagram(data) else { return .invalid }
        switch datagram {
        case .frame(let frame):
            return .frames([frame])
        case .logBatchChunk(let chunk):
            return accept(chunk)
        }
    }

    private mutating func accept(_ chunk: ObservationLogBatchChunk) -> ObservationDatagramDecodeResult {
        if chunk.index == 0 {
            generation = chunk.generation
            expectedChunkIndex = 0
            chunkCount = chunk.count
            payload.removeAll(keepingCapacity: true)
        }
        guard generation == chunk.generation,
              chunk.count == chunkCount,
              chunk.index == expectedChunkIndex,
              payload.count + chunk.payload.count <= ObservationFrameCodec.maxLogBatchBytes else {
            reset()
            return .invalid
        }

        payload.append(chunk.payload)
        expectedChunkIndex += 1
        guard expectedChunkIndex == chunkCount else { return .awaitingMore }

        let completedPayload = payload
        reset()
        guard let frames = ObservationFrameCodec.decodeLogBatchPayload(completedPayload) else { return .invalid }
        return .frames(frames)
    }

    private mutating func reset() {
        generation = nil
        expectedChunkIndex = 0
        chunkCount = 0
        payload.removeAll(keepingCapacity: true)
    }
}

private enum DecodedObservationDatagram {
    case frame(ObservationFrame)
    case logBatchChunk(ObservationLogBatchChunk)
}

private struct ObservationLogBatchChunk {
    let generation: UInt64
    let index: Int
    let count: Int
    let payload: Data
}

public enum ObservationFrameCodec {
    /// Darwin 默认 maxdgram 为 2048，留出系统与协议头余量。
    public static let maxDatagramBytes = 1800
    public static let maxFrameBytes = maxDatagramBytes
    public static let maxLogMessageBytes = EngineLogPolicy.maximumMessageBytes
    public static let maxLogBatchEntries = 64
    public static let maxLogBatchBytes = 48 * 1024
    public static let requiredReceiveBufferBytes = 64 * 1024

    /// 单帧日志的正文上限：单行策略上限与 datagram 余量（减去 kind + level 两字节）取严。
    private static let maxSingleLogFrameMessageBytes = min(maxLogMessageBytes, maxDatagramBytes - 2)

    private static let logBatchChunkHeaderBytes = 1
        + MemoryLayout<UInt64>.size
        + MemoryLayout<UInt16>.size
        + MemoryLayout<UInt16>.size
    private static let maxLogBatchChunkPayloadBytes = maxDatagramBytes - logBatchChunkHeaderBytes
    private static let maximumLogBatchDatagrams =
        (maxLogBatchBytes + maxLogBatchChunkPayloadBytes - 1) / maxLogBatchChunkPayloadBytes
    public static let maximumEncodedLogBatchBytes =
        maxLogBatchBytes + maximumLogBatchDatagrams * logBatchChunkHeaderBytes

    private enum Kind: UInt8 {
        case traffic = 1
        case log = 2
        case groupsInvalidation = 3
        case logBatchChunk = 4
        case sessionStats = 5
    }

    /// 会话统计帧：种类 + 会话起点 + 最新样本时刻 + 样本数，之后每样本
    /// 回溯毫秒(UInt32) + 内存(Int64) + 上行(Int64) + 下行(Int64)。
    private static let sessionStatsHeaderBytes = 1 + 8 + 8 + 2
    private static let sessionStatsSampleBytes = 4 + 8 + 8 + 8

    /// 一个 datagram 装得下的样本数上限。1 Hz 下 60 秒窗口约 61 个；超出时保留最新的。
    public static let maxSessionStatsSamples = (maxDatagramBytes - sessionStatsHeaderBytes) / sessionStatsSampleBytes

    public static func encode(_ frame: ObservationFrame) -> Data {
        var data = Data()
        switch frame {
        case .traffic(let traffic):
            data.append(Kind.traffic.rawValue)
            appendLE(traffic.up, to: &data)
            appendLE(traffic.down, to: &data)
            appendLE(traffic.upTotal, to: &data)
            appendLE(traffic.downTotal, to: &data)
            appendLE(traffic.memory, to: &data)
            appendLE(traffic.memoryPeak, to: &data)
            appendLE(Int32(clamping: traffic.connIn), to: &data)
            appendLE(Int32(clamping: traffic.connOut), to: &data)
        case .log(let line):
            data.append(Kind.log.rawValue)
            data.append(UInt8(clamping: line.level.rawValue))
            data.append(truncatedUtf8(line.message, maxBytes: maxSingleLogFrameMessageBytes))
        case .groupsInvalidation(let generation):
            data.append(Kind.groupsInvalidation.rawValue)
            appendLE(generation, to: &data)
        case .sessionStats(let stats):
            encodeSessionStats(stats, into: &data)
        }
        return data
    }

    private static func encodeSessionStats(_ stats: SessionStats, into data: inout Data) {
        let memory = stats.memoryTrend.samples.suffix(maxSessionStatsSamples)
        let rates = stats.rateTrend.samples.suffix(maxSessionStatsSamples)
        precondition(
            memory.map(\.atMillis) == rates.map(\.atMillis),
            "session stats trends must share one timeline"
        )
        let newest = memory.last?.atMillis ?? stats.startedAtMillis
        data.append(Kind.sessionStats.rawValue)
        appendLE(stats.startedAtMillis, to: &data)
        appendLE(newest, to: &data)
        appendLE(UInt16(memory.count), to: &data)
        for (sample, rate) in zip(memory, rates) {
            // 窗口按时间收敛到 60 秒，回溯量超出 UInt32 只可能是持有方的时间轴坏了。
            guard let back = UInt32(exactly: newest - sample.atMillis) else {
                preconditionFailure("session stats sample outside the window: \(sample.atMillis) vs newest \(newest)")
            }
            appendLE(back, to: &data)
            appendLE(sample.bytes, to: &data)
            appendLE(rate.up, to: &data)
            appendLE(rate.down, to: &data)
        }
    }

    private static func decodeSessionStats(_ data: Data, _ offset: inout Int) -> SessionStats? {
        guard let startedAt: Int64 = readLE(data, &offset),
              let newest: Int64 = readLE(data, &offset),
              let rawCount: UInt16 = readLE(data, &offset),
              Int(rawCount) <= maxSessionStatsSamples,
              data.count - offset == Int(rawCount) * sessionStatsSampleBytes else { return nil }
        // 时长 = 最新 − 起点：两者关系不成立的帧，后续任何相减都可能溢出，整帧拒绝。
        if rawCount > 0 {
            let (uptime, overflow) = newest.subtractingReportingOverflow(startedAt)
            guard !overflow, uptime >= 0 else { return nil }
        }
        var memory: [MemorySample] = []
        var rates: [RateSample] = []
        for index in 0..<Int(rawCount) {
            guard let back: UInt32 = readLE(data, &offset),
                  let bytes: Int64 = readLE(data, &offset),
                  let up: Int64 = readLE(data, &offset),
                  let down: Int64 = readLE(data, &offset),
                  bytes >= 0, up >= 0, down >= 0,
                  Int64(back) <= MemoryTrend.windowMillis else { return nil }
            let (at, underflow) = newest.subtractingReportingOverflow(Int64(back))
            // 样本按时间先后排列、不早于会话起点、最后一个就是最新时刻：对端编码器只产出这种形状。
            guard !underflow, at >= startedAt else { return nil }
            if let previous = memory.last, at < previous.atMillis { return nil }
            if index == Int(rawCount) - 1, back != 0 { return nil }
            memory.append(MemorySample(atMillis: at, bytes: bytes))
            rates.append(RateSample(atMillis: at, up: up, down: down))
        }
        return SessionStats(
            startedAtMillis: startedAt,
            memoryTrend: MemoryTrend(samples: memory),
            rateTrend: TrafficRateTrend(samples: rates)
        )
    }

    /// 一个逻辑批次最多 64 条 / 48 KiB，再切成符合 Darwin 上限的 datagram。
    public static func encodeLogBatch(
        _ lines: ArraySlice<LogLine>,
        generation: UInt64
    ) -> (datagrams: [Data], entryCount: Int)? {
        guard !lines.isEmpty else { return nil }
        var payload = Data()
        appendLE(UInt16.zero, to: &payload)
        var entryCount = 0
        for line in lines.prefix(maxLogBatchEntries) {
            let message = truncatedUtf8(line.message, maxBytes: maxLogMessageBytes)
            let entryBytes = 1 + MemoryLayout<UInt16>.size + message.count
            guard payload.count + entryBytes <= maxLogBatchBytes else { break }
            payload.append(UInt8(clamping: line.level.rawValue))
            appendLE(UInt16(message.count), to: &payload)
            payload.append(message)
            entryCount += 1
        }
        guard entryCount > 0 else { return nil }
        replaceLE(UInt16(entryCount), in: &payload, at: 0)

        let chunkCount = (payload.count + maxLogBatchChunkPayloadBytes - 1) / maxLogBatchChunkPayloadBytes
        var datagrams: [Data] = []
        datagrams.reserveCapacity(chunkCount)
        for chunkIndex in 0..<chunkCount {
            let start = chunkIndex * maxLogBatchChunkPayloadBytes
            let end = min(start + maxLogBatchChunkPayloadBytes, payload.count)
            var datagram = Data()
            datagram.append(Kind.logBatchChunk.rawValue)
            appendLE(generation, to: &datagram)
            appendLE(UInt16(chunkIndex), to: &datagram)
            appendLE(UInt16(chunkCount), to: &datagram)
            datagram.append(payload.subdata(in: start..<end))
            datagrams.append(datagram)
        }
        return (datagrams, entryCount)
    }

    /// 坏帧返回 nil 而非抛出：datagram 是 best-effort，读循环遇到截断/陈旧帧应丢弃继续，
    /// 不能因单帧异常中断观察。调用方负责对 nil 计数或告警。
    public static func decode(_ data: Data) -> ObservationFrame? {
        guard data.count <= maxFrameBytes, let first = data.first, let kind = Kind(rawValue: first) else {
            return nil
        }
        // Data 可能是 slice（startIndex 非 0），一律用相对偏移。
        var offset = 1
        switch kind {
        case .traffic:
            guard let up: Int64 = readLE(data, &offset),
                  let down: Int64 = readLE(data, &offset),
                  let upTotal: Int64 = readLE(data, &offset),
                  let downTotal: Int64 = readLE(data, &offset),
                  let memory: Int64 = readLE(data, &offset),
                  let memoryPeak: Int64 = readLE(data, &offset),
                  let connIn: Int32 = readLE(data, &offset),
                  let connOut: Int32 = readLE(data, &offset),
                  offset == data.count else { return nil }
            return .traffic(Traffic(
                up: up,
                down: down,
                upTotal: upTotal,
                downTotal: downTotal,
                memory: memory,
                memoryPeak: memoryPeak,
                connIn: Int(connIn),
                connOut: Int(connOut)
            ))
        case .log:
            guard data.count >= 2,
                  let level = LogLevel(rawValue: Int(data[data.startIndex + 1])) else { return nil }
            let message = String(decoding: data.dropFirst(2), as: UTF8.self)
            return .log(LogLine(level: level, message: message))
        case .groupsInvalidation:
            guard let generation: UInt64 = readLE(data, &offset), offset == data.count else { return nil }
            return .groupsInvalidation(generation: generation)
        case .sessionStats:
            return decodeSessionStats(data, &offset).map(ObservationFrame.sessionStats)
        case .logBatchChunk:
            return nil
        }
    }

    fileprivate static func decodeDatagram(_ data: Data) -> DecodedObservationDatagram? {
        guard data.count <= maxDatagramBytes,
              let first = data.first,
              let kind = Kind(rawValue: first) else { return nil }
        if kind != .logBatchChunk {
            guard let frame = decode(data) else { return nil }
            return .frame(frame)
        }

        var offset = 1
        guard let generation: UInt64 = readLE(data, &offset),
              let rawChunkIndex: UInt16 = readLE(data, &offset),
              let rawChunkCount: UInt16 = readLE(data, &offset) else { return nil }
        let chunkIndex = Int(rawChunkIndex)
        let chunkCount = Int(rawChunkCount)
        guard chunkCount > 0,
              chunkCount <= maximumLogBatchDatagrams,
              chunkIndex < chunkCount,
              offset < data.count else { return nil }
        return .logBatchChunk(ObservationLogBatchChunk(
            generation: generation,
            index: chunkIndex,
            count: chunkCount,
            payload: data.dropFirst(offset)
        ))
    }

    fileprivate static func decodeLogBatchPayload(_ data: Data) -> [ObservationFrame]? {
        guard data.count <= maxLogBatchBytes else { return nil }
        var offset = 0
        guard let rawEntryCount: UInt16 = readLE(data, &offset) else { return nil }
        let entryCount = Int(rawEntryCount)
        guard entryCount > 0, entryCount <= maxLogBatchEntries else { return nil }

        var frames: [ObservationFrame] = []
        frames.reserveCapacity(entryCount)
        for _ in 0..<entryCount {
            guard offset < data.count,
                  let level = LogLevel(rawValue: Int(data[data.startIndex + offset])) else { return nil }
            offset += 1
            guard let rawMessageBytes: UInt16 = readLE(data, &offset) else { return nil }
            let messageBytes = Int(rawMessageBytes)
            guard messageBytes <= maxLogMessageBytes, offset + messageBytes <= data.count else { return nil }
            let start = data.startIndex + offset
            let message = String(decoding: data[start..<(start + messageBytes)], as: UTF8.self)
            offset += messageBytes
            frames.append(.log(LogLine(level: level, message: message)))
        }
        guard offset == data.count else { return nil }
        return frames
    }

    // MARK: - 定长整数编解码（小端固定宽度，跨进程不依赖平台字长）

    private static func appendLE<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }

    private static func replaceLE<T: FixedWidthInteger>(_ value: T, in data: inout Data, at offset: Int) {
        withUnsafeBytes(of: value.littleEndian) { bytes in
            data.replaceSubrange(offset..<(offset + bytes.count), with: bytes)
        }
    }

    private static func readLE<T: FixedWidthInteger>(_ data: Data, _ offset: inout Int) -> T? {
        let size = MemoryLayout<T>.size
        guard offset + size <= data.count else { return nil }
        let start = data.startIndex + offset
        var value = T.zero
        _ = withUnsafeMutableBytes(of: &value) { raw in
            data.copyBytes(to: raw, from: start..<(start + size))
        }
        offset += size
        return T(littleEndian: value)
    }

    // 截断落在 UTF8 字符边界上：直接切字节会产出替换字符，让日志尾部变成乱码。
    private static func truncatedUtf8(_ text: String, maxBytes: Int) -> Data {
        let utf8 = Data(text.utf8)
        if utf8.count <= maxBytes { return utf8 }
        var end = maxBytes
        while end > 0, utf8[utf8.startIndex + end] & 0xC0 == 0x80 { end -= 1 }
        return utf8.prefix(end)
    }
}
