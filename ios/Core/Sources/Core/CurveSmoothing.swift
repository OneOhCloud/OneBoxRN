import Foundation

/// 归一坐标系里的一个点：x ∈ [0,1] 沿时间窗，y ∈ [0,1] 是离基线的量（方向由平台侧决定）。
public struct CurvePoint: Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// 一段三次贝塞尔：起点是上一段的终点，故只带两个控制点与终点。
public struct CurveSegment: Equatable, Sendable {
    public let control1: CurvePoint
    public let control2: CurvePoint
    public let end: CurvePoint

    public init(control1: CurvePoint, control2: CurvePoint, end: CurvePoint) {
        self.control1 = control1
        self.control2 = control2
        self.end = end
    }
}

/// 折线/面积图在样本之间的平滑（网速图）。
///
/// 名字按**做的事**而不是按消费方取：叫 `SpeedCurve` 时，域词「Speed」描述的是
/// 那一个调用点而非算法本身。
///
/// 放在 Core 而不是各端画法里：曲线形状是可观察结果，两端各写一套必然背离，而这种背离
/// 肉眼比对不出来——只有夹具能裁。平台侧只负责把归一坐标映射到像素与方向。
public enum CurveSmoothing {
    /// Fritsch–Carlson 单调三次插值转贝塞尔：曲线**经过**每一个输入点，故不改样本值。
    ///
    /// 选它而不是 Catmull-Rom：后者在局部极值处切线不为零，
    /// 1 Hz 采样下的单拍尖峰会被画成三角形。本算法在极值处把切线压到 0，故**峰顶与谷底是圆的**。
    ///
    /// 限幅（α² + β² ≤ 9）同时给出两条不需另行钳制的性质：
    /// - 曲线**不越过两端样本值**——控制点 y 恒落在该段两端之间，面积既不穿过基线也不溢出归一分母；
    /// - 控制点 x 恒落在本段的三等分点上——曲线不可能在时间轴上回退自交。
    public static func smooth(_ points: [CurvePoint]) -> [CurveSegment] {
        guard points.count >= 2 else { return [] }
        let count = points.count
        let width = (0..<(count - 1)).map { points[$0 + 1].x - points[$0].x }
        let slope = (0..<(count - 1)).map { index -> Double in
            // 同一时刻的两个样本会让段宽为 0（趋势窗只禁时刻倒退、不禁相等）。斜率无从定义，
            // 按 0 处置：那一段退化成两点间的直连，读作「同一瞬间的两个读数」，
            // 而不是让一个 NaN 顺着切线传染整条曲线。
            width[index] > 0 ? (points[index + 1].y - points[index].y) / width[index] : 0
        }

        var tangent = [Double](repeating: 0, count: count)
        tangent[0] = slope[0]
        tangent[count - 1] = slope[count - 2]
        for index in 1..<(count - 1) {
            tangent[index] = (slope[index - 1] + slope[index]) / 2
        }

        for index in 0..<(count - 1) {
            if slope[index] == 0 {
                // 平段两端切线归零：极值点因此天然是平的（圆的），不会冒出一个越过样本的凸包。
                tangent[index] = 0
                tangent[index + 1] = 0
                continue
            }
            var head = tangent[index] / slope[index]
            var tail = tangent[index + 1] / slope[index]
            // 与本段斜率反向的切线一律归零——那正是局部极值，也是「峰顶要圆」的来源。
            if head < 0 {
                tangent[index] = 0
                head = 0
            }
            if tail < 0 {
                tangent[index + 1] = 0
                tail = 0
            }
            let magnitude = head * head + tail * tail
            if magnitude > 9 {
                let limit = 3 / magnitude.squareRoot()
                tangent[index] = limit * head * slope[index]
                tangent[index + 1] = limit * tail * slope[index]
            }
        }

        return (0..<(count - 1)).map { index in
            let third = width[index] / 3
            return CurveSegment(
                control1: CurvePoint(
                    x: points[index].x + third,
                    y: points[index].y + tangent[index] * third
                ),
                control2: CurvePoint(
                    x: points[index + 1].x - third,
                    y: points[index + 1].y - tangent[index + 1] * third
                ),
                end: points[index + 1]
            )
        }
    }
}
