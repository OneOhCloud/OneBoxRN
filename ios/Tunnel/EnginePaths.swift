import Foundation
import Core

// 引擎持久化路径单一来源（镜像 Android bridge/EnginePaths）：隧道进程内引擎绑定与
// 进程入口共用同一 App Group 容器根，App 与扩展落在同一容器。
enum EnginePaths {
    /// 命令 socket / 持久数据的根（iOS 上 UI 与隧道两进程必须落同一 App Group 容器）。
    /// 容器不可用 = entitlement 装配缺失：真机/发布 fail-loud 崩溃暴露（静默降级会让两进程落
    /// 不同沙盒、命令 socket 与 start_error.txt 错位，比崩溃更难查）；仅模拟器降级——其 App Group
    /// 容器偶发不可用且不跑真实 NE 隧道。
    static func base() -> URL {
        AppGroupPaths.baseDirectory()
    }

    static func working() -> URL { AppGroupPaths.workingDirectory() }

    static func temp() -> URL { AppGroupPaths.temporaryDirectory() }
}
