package cloud.oneoh.oneboxn.core

class TrafficRateEstimator {
    private var previous: Sample? = null

    fun estimate(
        rawUp: Long,
        rawDown: Long,
        upTotal: Long,
        downTotal: Long,
        memory: Long,
        connIn: Int,
        connOut: Int,
        nowMillis: Long,
    ): Traffic {
        val sanitizedUpTotal = upTotal.coerceAtLeast(0)
        val sanitizedDownTotal = downTotal.coerceAtLeast(0)
        val traffic = Traffic(
            up = rate(rawUp, sanitizedUpTotal, previous?.upTotal, nowMillis),
            down = rate(rawDown, sanitizedDownTotal, previous?.downTotal, nowMillis),
            upTotal = sanitizedUpTotal,
            downTotal = sanitizedDownTotal,
            memory = memory.coerceAtLeast(0),
            connIn = connIn.coerceAtLeast(0),
            connOut = connOut.coerceAtLeast(0),
        )
        previous = Sample(sanitizedUpTotal, sanitizedDownTotal, nowMillis)
        return traffic
    }

    private fun rate(raw: Long, total: Long, previousTotal: Long?, nowMillis: Long): Long {
        if (raw > 0) return raw
        val sample = previous ?: return 0
        previousTotal ?: return 0
        val elapsed = nowMillis - sample.atMillis
        if (elapsed <= 0 || total < previousTotal) return 0
        return (total - previousTotal) * 1_000 / elapsed
    }

    private data class Sample(
        val upTotal: Long,
        val downTotal: Long,
        val atMillis: Long,
    )
}
