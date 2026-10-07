import Foundation
import Observation
import Core

/// 可呈现给用户的新版本：商店上架的营销版本 + 商店页。商店查询只回营销版本、没有 build。
struct UpdateOffer: Equatable, Identifiable {
    let version: String
    let storeUrl: URL

    var id: String { version }
}

/// 最近一次检查走到哪一步；有新版本时由 `offer` 承担呈现。
enum UpdateCheckStatus: Equatable {
    case idle
    case checking
    case upToDate
    case failed
}

// 检查新版本的唯一编排点：调度判定 → 商店查询 → core 决策 → 记账。商店是唯一的判定来源。
// 自动触发（冷启动 / 回前台 / 后台）经 UpdateCheckTask 按调度进来；「立即检查」绕过调度。
@MainActor
@Observable
final class UpdateChecker {
    private(set) var offer: UpdateOffer?
    private(set) var status = UpdateCheckStatus.idle

    @ObservationIgnored private let storeLookup: AppStoreLookup
    @ObservationIgnored private let recordStore: UpdateCheckRecordStore
    @ObservationIgnored private let log: (LogLevel, String) -> Void

    init(
        storeLookup: AppStoreLookup,
        recordStore: UpdateCheckRecordStore,
        log: @escaping (LogLevel, String) -> Void
    ) {
        self.storeLookup = storeLookup
        self.recordStore = recordStore
        self.log = log
    }

    var checking: Bool { status == .checking }

    func checkIfDue(coldStart: Bool) async {
        guard !checking else { return }
        let record = recordStore.load()
        let input = UpdateCheckInput(
            nowMillis: Self.nowMillis(),
            lastSuccessMillis: record.lastSuccessMillis,
            lastAttemptMillis: record.lastAttemptMillis,
            consecutiveFailures: record.consecutiveFailures,
            coldStart: coldStart
        )
        let plan: UpdateCheckPlan
        do {
            plan = try UpdateCheckSchedule.plan(input)
        } catch {
            // 记账只由本类型成对写入，不自洽即写入逻辑有错。
            preconditionFailure("inconsistent update check record: \(error)")
        }
        guard plan.due else { return }
        await check()
    }

    /// 用户点的「检查更新」：「检查中」从点击起至少呈现 `UpdateCheckPacing` 的最短时长，结果等满再揭晓。
    func checkNow() async {
        guard !checking else { return }
        let clock = ContinuousClock()
        let startedAt = clock.now
        status = .checking
        let attempt = await attemptCheck()
        let elapsed = startedAt.duration(to: clock.now)
        let elapsedMillis = elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000
        let delayMillis = try! UpdateCheckPacing.revealDelayMillis(elapsedMillis: elapsedMillis)
        // 揭晓只是晚一点，不随任务取消而丢：结果与记账照常落地。
        try? await Task.sleep(for: .milliseconds(delayMillis))
        reveal(attempt)
    }

    private func check() async {
        status = .checking
        reveal(await attemptCheck())
    }

    /// 一次检查的过程与结局分开：结局何时落到版本卡由调用方定（手动检查要等满最短时长）。
    private struct CheckAttempt {
        let attemptAtMillis: Int64
        let outcome: Result<UpdateOffer?, Error>
    }

    private func attemptCheck() async -> CheckAttempt {
        let attemptAt = Self.nowMillis()
        do {
            return CheckAttempt(attemptAtMillis: attemptAt, outcome: .success(try await findOffer()))
        } catch {
            return CheckAttempt(attemptAtMillis: attemptAt, outcome: .failure(error))
        }
    }

    private func reveal(_ attempt: CheckAttempt) {
        switch attempt.outcome {
        case .success(let found):
            offer = found
            status = found == nil ? .upToDate : .idle
            account(attempt) { record in
                record.lastSuccessMillis = attempt.attemptAtMillis
                record.consecutiveFailures = 0
            }
            if let found { log(.info, "update available: \(found.version)") }
        // 请求根本没碰到网络（断网、首装的无线数据授权未决）：退避针对的是入口或商店本身的问题，
        // 这一次不算尝试、记账不动，回前台或网络路径恢复时按调度立即补查。
        case .failure(let error as UpdateTransportFailure) where error.networkUnreachable:
            status = .failed
            log(.info, "update check deferred, network unreachable: \(describe(error))")
        case .failure(let error):
            status = .failed
            account(attempt) { record in record.consecutiveFailures += 1 }
            log(.warn, "update check failed: \(describe(error))")
        }
    }

    private func account(_ attempt: CheckAttempt, _ change: (inout UpdateCheckRecord) -> Void) {
        var record = recordStore.load()
        record.lastAttemptMillis = attempt.attemptAtMillis
        change(&record)
        recordStore.save(record)
    }

    private func findOffer() async throws -> UpdateOffer? {
        let lookup = try await storeLookup.fetch()
        let installedVersion = InstalledRelease.version
        let decision = try UpdateDecision.decide(installedVersion: installedVersion, store: lookup.release)
        // 「商店有记录却不提示」是最需要取证的一条路径，查询事实与结论记在同一行。
        log(.debug, "update: installed \(installedVersion); store lookup storefront=\(lookup.storefront ?? "none") "
            + "resultCount=\(lookup.resultCount) version=\(lookup.release?.version ?? "none") -> \(decision)")
        switch decision {
        case .none:
            return nil
        case .storeAvailable(let storeUrl):
            guard let release = lookup.release, let url = URL(string: storeUrl) else { throw URLError(.badURL) }
            return UpdateOffer(version: release.version, storeUrl: url)
        }
    }

    private static func nowMillis() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded(.down))
    }
}


/// 已装构建的营销版本：缺失是打包错误，不是运行期状态。
enum InstalledRelease {
    static var version: String {
        guard let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String else {
            preconditionFailure("CFBundleShortVersionString missing from Info.plist")
        }
        return version
    }
}
