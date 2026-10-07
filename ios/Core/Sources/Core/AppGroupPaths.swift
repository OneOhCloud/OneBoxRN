import Foundation

public enum AppGroupPaths {
    // 这正是团队 provisioning profile 里已注册的 App Group（各份 profile 的
    // application-groups 均为该值）：它让 App 与隧道扩展落在同一容器。
    // 取值与各份 entitlements 同源（改一处必须同改）。
    public static let identifier = "group.cloud.oneoh.networktools"

    public static func baseDirectory() -> URL {
        if let shared = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) {
            return shared
        }
        #if targetEnvironment(simulator)
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        #else
        fatalError("App Group container \"\(identifier)\" unavailable — check entitlement wiring")
        #endif
    }

    public static func workingDirectory() -> URL {
        workingDirectory(base: baseDirectory())
    }

    /// 容器根由调用方给出的形态（观察绑定把它作为可注入依赖持有），层级仍由本处唯一决定。
    public static func workingDirectory(base: URL) -> URL {
        base.appendingPathComponent("engine")
    }

    /// 隧道诊断文件的目录。
    ///
    /// 放在容器的 `Library/` 下：开发签名的设备上，`devicectl` 只能从 App Group 的
    /// `Library` / `Documents` / `tmp` 拷出文件。放在别处，扩展死后的现场就只能靠 App 转述，
    /// 而 App 不在前台时恰恰什么都转述不了。
    public static func diagnosticsDirectory(base: URL = baseDirectory()) -> URL {
        base.appendingPathComponent(TunnelFile.diagnosticsDirectory, isDirectory: true)
    }

    /// 跨进程文件的落点：相对路径的唯一出处是 `TunnelFile`，这里只把它接到容器根上。
    ///
    /// 写的是隧道扩展、读的是 App，任一侧笔误都不会有人报错——只会让整级诊断从此静默消失，
    /// 故两侧都经这一处取路径。
    public static func url(_ file: TunnelFile, base: URL = baseDirectory()) -> URL {
        ContainerTunnelFiles(base: base).url(file)
    }

    /// 启动诊断（诊断阶梯第 1 级：引擎真因）。隧道扩展写、App 读。
    public static func startErrorURL(base: URL = baseDirectory()) -> URL { url(.startError, base: base) }

    /// 启动期引擎日志（隧道进程写、App 回读）。
    public static func startupLogURL(base: URL = baseDirectory()) -> URL { url(.startupLog, base: base) }

    /// 启动阶段标记（诊断阶梯第 2 级：终止于哪个阶段）。
    public static func startStageURL(base: URL = baseDirectory()) -> URL { url(.startStage, base: base) }

    /// 隧道运行期日志：当前文件在后、轮转文件在前，按时间先后排列。
    public static func tunnelJournalURLs(base: URL = baseDirectory()) -> (rotated: URL, current: URL) {
        (url(.journalRotated, base: base), url(.journalCurrent, base: base))
    }

    public static func temporaryDirectory() -> URL {
        baseDirectory().appendingPathComponent("tmp")
    }

    public static func startOptionsURL() -> URL {
        url(.startOptions)
    }

    /// 热重载结局：隧道扩展写、App 在应答缺失时读来对账。
    /// 与启动快照同住容器根，两者都是「跨这道进程边界传一件事」而非引擎工作目录里的产物。
    public static func reloadOutcomeURL() -> URL {
        url(.reloadOutcome)
    }

    /// 本机用量账本目录：隧道扩展写、App 读，故住 App Group 容器。
    public static func usageDirectory() -> URL {
        baseDirectory().appendingPathComponent(UsageHistory.directoryName)
    }
}
