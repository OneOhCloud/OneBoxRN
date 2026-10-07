import Foundation

// 启动期会话对账的判据。
//
// 隧道进程的寿命长于 App 进程（它由系统按需拉起、也由系统终止），两者可以不同代：App 被覆盖
// 安装或被杀后重开时，系统的会话可能还挂在一个已经死掉、或属于上一份构建的隧道进程上。此时
// OS 说「已连接」而实际没有任何进程在转发，UI 的连接真相如实照搬那个「已连接」，于是
// 首页显示连着、数据面却是黑洞。
//
// Android 无对等件：那边的隧道是本进程可见的前台服务，不存在这种跨进程代际错配。
public enum StaleSessionConnection: Sendable, Equatable {
    case connected
    case notConnected
}

public enum StaleSessionReconciliation: Sendable, Equatable {
    case pending
    case reconciled
}

public enum StaleSessionProviderProbe: Sendable, Equatable {
    case responded
    case unresponsive
}

public enum StaleSessionGate {
    /// 这一拍是否该向隧道进程探活。
    ///
    /// 只在 OS 报告已连接时问：其余状态下「隧道进程不回应」本就是正常的（还没被拉起、正在
    /// 拉起、已经停了），据此停止会打断一次正常的启动。
    ///
    /// 只问一次：本条要解决的形态只在启动沿产生，周期巡检会与断流检测重叠成第二套真相。
    public static func probeNeeded(
        connection: StaleSessionConnection,
        reconciliation: StaleSessionReconciliation
    ) -> Bool {
        connection == .connected && reconciliation == .pending
    }

    /// 探活之后是否该请系统停止这条会话。
    ///
    /// **要重核连接真相**：探活有自己的上限，这段窗口里用户可能已经手动断开、或一次新的启动
    /// 已经在飞；拿探活出发时的旧真相下手会停掉不该停的那一条。
    ///
    /// 判据不含观察通道健康度：那有自己的失效与重建语义，两件事搅在一起会让一次
    /// 瞬时断流触发一次断开。
    public static func stopNeeded(
        connection: StaleSessionConnection,
        providerProbe: StaleSessionProviderProbe
    ) -> Bool {
        connection == .connected && providerProbe == .unresponsive
    }
}
