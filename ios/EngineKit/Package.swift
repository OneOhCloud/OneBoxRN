// swift-tools-version: 6.0
import PackageDescription

// Go 静态归档只链接进这一份动态产品；宿主 app 嵌入它，app 与隧道扩展
// 从磁盘加载同一份 framework。
let package = Package(
    name: "EngineKit",
    // 只声明 iOS：EngineLink.xcframework 只有 iOS 两腿（真机 + 模拟器）。
    platforms: [.iOS(.v18)],
    products: [
        .library(name: "EngineKit", type: .dynamic, targets: ["EngineKit"]),
    ],
    targets: [
        .binaryTarget(name: "EngineFFI", path: "EngineLink.xcframework"),
        .target(
            name: "EngineKit",
            dependencies: ["EngineFFI"],
            publicHeadersPath: "include",
            linkerSettings: [
                .linkedFramework("UIKit"),
                // 引擎的系统 TLS 客户端经 Network.framework 建连。
                .linkedFramework("Network"),
                .linkedLibrary("resolv"),
            ]
        ),
    ]
)
