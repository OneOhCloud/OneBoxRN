import Foundation

public struct TrafficRateEstimator: Sendable {
    private var previous: Sample?

    public init() {}

    public mutating func estimate(
        rawUp: Int64,
        rawDown: Int64,
        upTotal: Int64,
        downTotal: Int64,
        memory: Int64,
        connIn: Int,
        connOut: Int,
        nowMillis: Int64
    ) -> Traffic {
        let sanitizedUpTotal = max(upTotal, 0)
        let sanitizedDownTotal = max(downTotal, 0)
        defer {
            previous = Sample(
                upTotal: sanitizedUpTotal,
                downTotal: sanitizedDownTotal,
                atMillis: nowMillis
            )
        }
        return Traffic(
            up: rate(raw: rawUp, total: sanitizedUpTotal, previousTotal: previous?.upTotal, nowMillis: nowMillis),
            down: rate(raw: rawDown, total: sanitizedDownTotal, previousTotal: previous?.downTotal, nowMillis: nowMillis),
            upTotal: sanitizedUpTotal,
            downTotal: sanitizedDownTotal,
            memory: max(memory, 0),
            connIn: max(connIn, 0),
            connOut: max(connOut, 0)
        )
    }

    private func rate(
        raw: Int64,
        total: Int64,
        previousTotal: Int64?,
        nowMillis: Int64
    ) -> Int64 {
        if raw > 0 { return raw }
        guard let previous, let previousTotal else { return 0 }
        let elapsed = nowMillis - previous.atMillis
        guard elapsed > 0, total >= previousTotal else { return 0 }
        return (total - previousTotal) * 1_000 / elapsed
    }

    private struct Sample: Sendable {
        let upTotal: Int64
        let downTotal: Int64
        let atMillis: Int64
    }
}
