import Foundation

// 刷新写回管线：手动与后台刷新共用的唯一实现。
// 错误面 = 导入三类（downloadHttp/downloadNetwork/invalidContent）；刷新无启动步，startFailed 不可达。
// 与 Android core/ConfigRefresh.kt 逐字对应，golden/config-refresh.json 是行为裁判。

public enum RefreshOutcome {
    case updated(info: TrafficInfo, contentChanged: Bool)

    /// 来源 url 已无对应 profile：零写入。
    case dropped

    case failed(ImportError)
}

public final class ConfigRefresh {
    private let fetcher: ConfigFetcher
    private let store: ProfileStore
    private let userAgent: () -> String
    private let now: () -> Int64

    public init(
        fetcher: ConfigFetcher,
        store: ProfileStore,
        userAgent: @escaping () -> String,
        now: @escaping () -> Int64
    ) {
        self.fetcher = fetcher
        self.store = store
        self.userAgent = userAgent
        self.now = now
    }

    /// 写回不变量：结果只写来源 url 对应的 profile；不改名、不改激活、不触碰隧道。取消异常原样上抛。
    public func run(url: String) async throws -> RefreshOutcome {
        let reply: FetchReply
        do {
            reply = try await fetcher.fetch(url: url, userAgent: userAgent())
        } catch let cancelled as CancellationError {
            throw cancelled
        } catch {
            // 外部传输失败在端口边界转类型化领域错误；诊断文本与 ImportFlow 同源。
            return .failed(.downloadNetwork(message: describe(error)))
        }
        if !(200...299).contains(reply.status) { return .failed(.downloadHttp(statusCode: reply.status)) }
        if case .invalid(let reason) = ConfigCheck.validate(reply.body) {
            return .failed(.invalidContent(reason: reason))
        }
        let info = Userinfo.parse(reply.header(Userinfo.HEADER))
        let metadata = RefreshedMetadata(
            info: info,
            updatedAt: now(),
            website: ProfileWebsite.parse(reply.header(ProfileWebsite.HEADER))
        )
        switch store.applyRefresh(url: url, metadata: metadata, content: reply.body) {
        case .applied(let contentChanged): return .updated(info: info, contentChanged: contentChanged)
        case .dropped: return .dropped
        }
    }
}
