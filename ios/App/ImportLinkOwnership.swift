import UIKit

// 本 App 与 OneBoxN 注册同一个深链 scheme，iOS 不保证把链接交给谁；OneBoxN 在设备上时由它导入。
// OneBoxN 另注册一个只用来接收转交的 scheme（查询串格式不变），本 App 据此探测它在不在，并把链接改投过去。
@MainActor
enum ImportLinkOwnership {
    private static let forwardingScheme = "oneboxn"

    /// 已转交返回 true，本 App 不再导入；OneBoxN 不在时返回 false，由本 App 照常导入。
    static func forwardToPreferredHandler(_ link: URL) -> Bool {
        var components = URLComponents(url: link, resolvingAgainstBaseURL: false)
        components?.scheme = forwardingScheme
        guard let forwarded = components?.url, UIApplication.shared.canOpenURL(forwarded) else { return false }
        UIApplication.shared.open(forwarded)
        return true
    }
}
