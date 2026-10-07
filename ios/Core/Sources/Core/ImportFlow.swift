import Foundation

// 导入流水线：从 ImportPayload 到「profile 已存储并激活
// （以及 apply 时隧道已启动）」的直线序。每相位先 onPhase 再执行，终态也经 onPhase 后返回。
// 领域错误共四类；调用方取消原样上抛，不映射为领域错误。
// 与 Android core/ImportFlow.kt 逐字对应，golden/import-flow.json 是行为裁判。

public enum ImportError: Sendable, Equatable {
    /// HTTP 非 2xx。
    case downloadHttp(statusCode: Int)

    /// 传输层失败（超时/DNS/TLS/断网）：message 承载原始诊断供失败视图呈现。
    case downloadNetwork(message: String)

    /// 内容校验拒绝。
    case invalidContent(reason: ContentReject)

    /// 启动失败/超时：message 承载引擎诊断；已存储的 profile 不回滚。
    case startFailed(message: String)

    /// 稳定 token：golden 相位轨迹与终态断言用；i18n 文案在 UI 层映射。
    public var token: String {
        switch self {
        case .downloadHttp(let statusCode):
            return "download-http:\(statusCode)"
        case .downloadNetwork:
            return "download-network"
        case .invalidContent(let reason):
            switch reason {
            case .empty: return "invalid-content:empty"
            case .notJson: return "invalid-content:not-json"
            case .notObject: return "invalid-content:not-object"
            }
        case .startFailed:
            return "start-failed"
        }
    }
}

/// 这一次导入往列表里写的是新的一份，还是同一链接的那一份换了新内容。判据是导入前列表里有没有同一 URL。
public enum ImportOutcome: String, Sendable, Equatable {
    case added
    case updated
}

/// 存好的那一份（已是当前配置）连同这次导入的结局。成功相位直接带回它：配置列表与当前配置要等
/// 流水线收尾才重发，结论页若去读那两份，会先闪一下旧的当前配置。
public struct ImportedProfile: Sendable, Equatable {
    public let profile: Profile
    public let outcome: ImportOutcome

    public init(profile: Profile, outcome: ImportOutcome) {
        self.profile = profile
        self.outcome = outcome
    }
}

public enum ImportPhase: Sendable, Equatable {
    case verifying
    case stopping
    case downloading(willApply: Bool)
    case success(info: TrafficInfo, imported: ImportedProfile)
    case applying
    case applied(ImportedProfile)
    case failed(ImportError)

    /// 稳定 token：golden 相位轨迹用。
    public var token: String {
        switch self {
        case .verifying: return "verifying"
        case .stopping: return "stopping"
        case .downloading(let willApply): return "downloading(apply=\(willApply))"
        case .success: return "success"
        case .applying: return "applying"
        case .applied: return "applied"
        case .failed(let error): return "failed(\(error.token))"
        }
    }
}

public final class ImportFlow {
    private let fetcher: ConfigFetcher
    private let tunnel: TunnelControl
    private let store: ProfileStore
    private let trusted: Set<String>
    private let userAgent: () -> String
    private let now: () -> Int64
    private let newId: () -> String

    public init(
        fetcher: ConfigFetcher,
        tunnel: TunnelControl,
        store: ProfileStore,
        trusted: Set<String>,
        userAgent: @escaping () -> String,
        now: @escaping () -> Int64,
        newId: @escaping () -> String
    ) {
        self.fetcher = fetcher
        self.tunnel = tunnel
        self.store = store
        self.trusted = trusted
        self.userAgent = userAgent
        self.now = now
        self.newId = newId
    }

    public func run(payload: ImportPayload, onPhase: (ImportPhase) -> Void) async throws -> ImportPhase {
        // 仅 requestedApply 验证域名；未命中不报错，降级为手动导入继续（willApply 只减不增）。
        var willApply = false
        if payload.requestedApply {
            onPhase(.verifying)
            willApply = DomainVerify.verify(UrlInfo.hostname(payload.url), allowedSha256: trusted)
        }
        // willApply 才停隧道；stop 对上不抛，超时/异常结局均继续下载。
        if willApply {
            onPhase(.stopping)
            await tunnel.stop()
        }
        onPhase(.downloading(willApply: willApply))
        let reply: FetchReply
        do {
            reply = try await fetcher.fetch(url: payload.url, userAgent: userAgent())
        } catch let cancelled as CancellationError {
            throw cancelled // 调用方取消原样上抛。
        } catch {
            return finish(.failed(.downloadNetwork(message: describe(error))), onPhase)
        }
        if !(200...299).contains(reply.status) {
            return finish(.failed(.downloadHttp(statusCode: reply.status)), onPhase)
        }
        if case .invalid(let reason) = ConfigCheck.validate(reply.body) {
            return finish(.failed(.invalidContent(reason: reason)), onPhase)
        }
        let info = Userinfo.parse(reply.header(Userinfo.HEADER))
        let existing = store.getAll().first { $0.url == payload.url }
        let outcome: ImportOutcome = existing == nil ? .added : .updated
        let name = ProfileName.derive(
            contentDisposition: reply.header("content-disposition"),
            existingName: existing?.name ?? "",
            url: payload.url
        )
        let importedAt = now()
        let stored = store.upsertByUrlAndActivate(
            Profile(
                id: newId(),
                name: name,
                url: payload.url,
                usedTraffic: info.upload + info.download,
                totalTraffic: info.total,
                expireTime: info.expire, // 单位 Unix 纪元秒，展示层换算。
                addedAt: importedAt,
                updatedAt: importedAt,
                website: ProfileWebsite.parse(reply.header(ProfileWebsite.HEADER))
            ),
            content: reply.body // 存原始响应体，改写全部延至启动期合并。
        )
        let imported = ImportedProfile(profile: stored, outcome: outcome)
        if !willApply { return finish(.success(info: info, imported: imported), onPhase) }
        onPhase(.applying)
        do {
            try await tunnel.start()
        } catch let cancelled as CancellationError {
            throw cancelled // 已存储的 profile 保留。
        } catch {
            // 已存储的 profile 不回滚，保持断开态。
            return finish(.failed(.startFailed(message: describe(error))), onPhase)
        }
        return finish(.applied(imported), onPhase)
    }

    // 终态也依序对 UI 可见，经 onPhase 后作为返回值。
    private func finish(_ terminal: ImportPhase, _ onPhase: (ImportPhase) -> Void) -> ImportPhase {
        onPhase(terminal)
        return terminal
    }
}
