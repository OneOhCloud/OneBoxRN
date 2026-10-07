package cloud.oneoh.oneboxn.core

/**
 * 用量柱图的命中判据。
 *
 * 放在 core 而不是各端手势里：两端的柱布局一个手算宽度、一个交给等分容器，边界那一格
 * 落到左边还是右边是可观察结果，各写一套的背离肉眼比对不出来——只有夹具能裁。
 */
object UsageChartHit {
    /**
     * 归一横坐标 → 格索引。图按 [cellCount] **等分**，柱间那 1dp 缝隙不单独成区——
     * 缝隙归右边那一格（等分边界即下一格的起点），否则点在缝上会「没反应」，
     * 而用户分不清那是没数据还是点歪了。
     *
     * 越界先钳到 [0,1] 再定位：手势在视图边缘可能报出略微出界的坐标，那仍是一次落在图上的点按。
     * 恰好落在右边界（分数 1）归末格——它是图上的最后一个像素，不是第 [cellCount] 格。
     *
     * 无格可命中是调用方 bug（空图不该挂手势），故 fail-fast 而非返回哨兵值。
     */
    fun index(fractionX: Double, cellCount: Int): Int {
        require(cellCount > 0) { "usage chart hit test needs at least one cell" }
        val clamped = fractionX.coerceIn(0.0, 1.0)
        return minOf((clamped * cellCount).toInt(), cellCount - 1)
    }
}
