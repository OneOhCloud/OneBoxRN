import Foundation
@preconcurrency import NetworkExtension
import Core
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.control", category: "Gateway")

/// 控件侧操作系统 VPN 会话的**唯一处**。
///
/// **本文件承载一个没有文档承诺的平台前提**：Apple 把 NE 配置定义为由 packet-tunnel
/// 的 containing app 管理，`loadAllFromPreferences` 的文档措辞是「返回调用方创建的配置」。控件跑在
/// 独立扩展进程里，能否拿到并驱动**主 App 装的那一份**没有文档承诺。
///
/// 故这里每一步都落一行 `os_log`：从 Console 按 subsystem `cloud.oneoh.networktools.control`
/// 过滤就能直接读出结论，而不是靠「点了没反应」倒推。
enum TunnelSessionGateway {

    enum GatewayError: Error, LocalizedError {
        /// 扩展加载不到任何 manager——**即扩展进程拿不到 App 创建的配置**。
        case managerUnavailable
        /// 还没导入过配置：不是错误路径，是引导用户去开 App。
        case noStartOptions

        var errorDescription: String? {
            switch self {
            case .managerUnavailable:
                String(localized: "control_unavailable")
            case .noStartOptions:
                String(localized: "control_no_config")
            }
        }
    }

    /// 控件取值：**每次现读**，不留缓存。
    static func isOn() async -> Bool {
        guard let manager = await loadManager() else { return false }
        return displayedAsOn(manager.connection.status)
    }

    /// 呈现谓词：会话相位不是「未运行」即为开。控件在扩展里只有 `NEVPNStatus` 这一个
    /// 真相，故按状态直接映射到与 core `sessionPhase` 同一个谓词，不另立一套判断。
    static func displayedAsOn(_ status: NEVPNStatus) -> Bool {
        switch status {
        case .connected, .reasserting, .connecting:
            // `.reasserting` 必须算开：热重载期间系统状态正是它，翻成关会让用户
            // 看见一次并不存在的断线。
            return true
        case .disconnecting, .disconnected, .invalid:
            return false
        @unknown default:
            return false
        }
    }

    static func setOn(_ on: Bool) async throws {
        guard let manager = await loadManager() else {
            logger.error("SPIKE VERDICT: no manager reachable from the control extension")
            throw GatewayError.managerUnavailable
        }
        if on {
            guard startOptionsSnapshotExists() else {
                logger.log("no start options snapshot — user has not imported a config yet")
                throw GatewayError.noStartOptions
            }
            // **不带 options**：最新配置由 App 写进 App Group 快照，隧道扩展从那里恢复。
            // 这是 On-Demand 已在用的既有回落路径，控件不新增第二条。
            try manager.connection.startVPNTunnel()
            logger.log("SPIKE VERDICT: startVPNTunnel accepted from the control extension")
        } else {
            manager.connection.stopVPNTunnel()
            logger.log("SPIKE VERDICT: stopVPNTunnel issued from the control extension")
        }
    }

    private static func loadManager() async -> NETunnelProviderManager? {
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            // 这一行是核心读数：数量为 0 即「扩展进程拿不到 App 创建的配置」。
            logger.log("loadAllFromPreferences returned \(managers.count, privacy: .public) manager(s)")
            guard let manager = managers.first else { return nil }
            logger.log(
                "manager enabled=\(manager.isEnabled, privacy: .public) status=\(manager.connection.status.rawValue, privacy: .public)"
            )
            return manager
        } catch {
            logger.error("loadAllFromPreferences failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    /// 是否已有可用的启动数据。
    ///
    /// 不走 `AppGroupPaths.startOptionsURL()`：那条路在容器不可达时 `fatalError`，而控件里崩一下
    /// 只会让用户看到一个消失的控件、什么线索都没有。这里用同一个标识常量自己查，把不可达变成
    /// 一条可读的日志——标识仍是单一来源。
    private static func startOptionsSnapshotExists() -> Bool {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: AppGroupPaths.identifier) else {
            logger.error("SPIKE VERDICT: App Group container unreachable — check the control entitlement")
            return false
        }
        let url = container.appendingPathComponent(TunnelStartOptionsSnapshot.fileName)
        return FileManager.default.fileExists(atPath: url.path)
    }
}
