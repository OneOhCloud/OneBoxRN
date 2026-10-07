// swift-tools-version: 6.0
import Foundation
import PackageDescription

// 测试是私有资产、不入公开仓库：只在本机存在测试目录时声明测试 target，公开克隆照样能解析与构建。
let hasTests = FileManager.default.fileExists(atPath: Context.packageDirectory + "/Tests/CoreTests")

// 本地纯逻辑包：不 import 上游库 / UIKit。声明 macOS 平台，使
// `swift test` 在宿主上无设备可跑。
let package = Package(
    name: "Core",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "Core", targets: ["Core"]),
    ],
    targets: [
        // NonisolatedNonsendingByDefault：async 函数随调用方执行体运行（对齐 Android 侧 suspend 语义）。
        // 消费方（@MainActor 的 AppActions）得以直接驱动非 Sendable 的 ImportFlow/ProfileStore，
        // 状态保持主线程独占；否则 Swift 6 按「切换全局执行器」语义拒绝跨界传递。
        .target(name: "Core", swiftSettings: [.enableUpcomingFeature("NonisolatedNonsendingByDefault")]),
    ] + (hasTests ? [.testTarget(name: "CoreTests", dependencies: ["Core"])] : [])
)
