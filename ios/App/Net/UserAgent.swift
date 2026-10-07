import Foundation

// 对外协议契约 UA（命名门禁豁免文件）。
// 配置服务端按 User-Agent 决定下发格式：结构化客户端 UA → 引擎 JSON 配置；
// 裸 UA → Clash YAML（引擎不认）。这里的客户端标记与引擎名（sing-box）
// 是服务端要求的协议字面量，非本仓自主命名——故本文件列入 Makefile NAMING_EXEMPT。
// 格式：`SFI/<appVer> (ios <arch> <os>; sing-box <engineVer>; language <lang>)`。
// 与 Android net/UserAgent.kt 同名对应。
enum UserAgent {
    private static let clientTag = "SFI"
    private static let platformToken = "ios"

    static func build(engineVersion: String) -> String {
        let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let arch = cpuArchitecture()
        let os = osVersion()
        let language = Locale.preferredLanguages.first ?? "en"
        return "\(clientTag)/\(appVersion) (\(platformToken) \(arch) \(os); sing-box \(engineVersion); language \(language))"
    }

    // 进程自身架构（Android 侧对应 Build.SUPPORTED_ABIS 首项）。
    private static func cpuArchitecture() -> String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "unknown"
        #endif
    }

    // 系统版本串（Android 侧对应 SDK_INT）；patch 为 0 时省略，与系统展示口径一致。
    private static func osVersion() -> String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return version.patchVersion == 0
            ? "\(version.majorVersion).\(version.minorVersion)"
            : "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }
}
