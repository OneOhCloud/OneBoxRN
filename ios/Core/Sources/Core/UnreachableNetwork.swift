import Foundation

/// 「请求根本没碰到网络」的判据：断网、连接中途丢失、蜂窝数据未放行。
/// 检查更新的退避针对的是入口或商店本身的问题；这类失败不算一次尝试，网络回来即可立即补查。
/// 只在 Apple 端存在：类别按 NSURLError 码划分，无跨端镜像。
public enum UnreachableNetwork {
    /// 首装期间系统「允许无线数据」授权未决时，请求以 notConnectedToInternet 或 dataNotAllowed 失败。
    private static let codes: Set<Int> = [
        URLError.notConnectedToInternet.rawValue,
        URLError.networkConnectionLost.rawValue,
        URLError.dataNotAllowed.rawValue,
        URLError.internationalRoamingOff.rawValue,
    ]

    public static func matches(urlErrorCode code: Int) -> Bool {
        codes.contains(code)
    }
}
