import Foundation

/// 强制升级页的唯一去处：新版客户端的 TestFlight 公开测试入口。
enum ForcedUpgradeDestination {
    static let url = URL(string: "https://testflight.apple.com/join/zkUySm5z")!
}
