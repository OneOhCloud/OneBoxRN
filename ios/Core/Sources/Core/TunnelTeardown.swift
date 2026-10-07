import Foundation

// 隧道进程拆除的时间预算。两端逐字对应。
//
// 系统给停止/销毁回调的时间是有限的：Apple 侧不在期限内返回即 SIGKILL 扩展，Android 侧
// `Service.onDestroy` 跑在主线程、超时即 ANR 或被杀。而引擎的停止有它自己的上界（实例关闭
// 加运行时关停，合计可达数秒），同步跑完再返回等于拿「优雅关闭」赌一次「被杀在拆除中途」。
//
// 赌输的代价不对称：被杀在「撤销隧道网络设置」之前，设备的默认路由仍指向一条已经不存在的
// 隧道——那不是隧道断了，是整机断网；而引擎没能优雅收尾的代价只是进程随即消失。故预算是
// **硬上限**而非建议值，超了就放手返回。
public enum TunnelTeardown {
    /// 整段拆除的硬上限。取值显著小于任何一端的系统宽限窗，留出被调度与写日志的余量。
    public static let totalBudgetMillis: Int64 = 2_500

    /// 「把网络设置还给系统」这一段的上限。它排在最前，也只有它的完成对设备可见。
    public static let networkSettingsBudgetMillis: Int64 = 1_000

    /// 停引擎还剩多少时间。恒不为负——已经超预算时返回 0，调用方据此立刻放手。
    public static func engineStopBudgetMillis(elapsedMillis: Int64) -> Int64 {
        max(0, totalBudgetMillis - elapsedMillis)
    }
}
