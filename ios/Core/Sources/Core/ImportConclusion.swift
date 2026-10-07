/// 首页电源砖此刻按下去会做什么（由砖的状态推出，在首页那一层）。导入结论页的主按钮与它同一语义：
/// 手动导入不重载隧道，砖要断开时（已连接、连接中）隧道在跑或正要跑，跑的仍是旧配置。
public enum HeroAction: String, Sendable {
    case connect
    case disconnect
}

/// 导入结束那一页的判定：成功时后果怎么说、主按钮给什么；失败时能不能重试。只给判定、不给文案。
/// golden/import-conclusion.json 是两端裁判（Android core/ImportConclusion.kt）。
///
/// 进行中与自动应用不在这里：前者还没有结论，后者直接回首页，没有结论页。
public enum ImportConclusion: Equatable, Sendable {
    /// 结论跟结局走（新增 → 导入成功，更新 → 配置已更新）；后果与主按钮跟电源砖此刻的动作走。次按钮恒为「完成」，不进判定。
    case succeeded(outcome: ImportOutcome, consequence: Consequence, primary: PrimaryAction)
    case failed(FailureActions)

    public enum Consequence: String, Sendable {
        /// 已设为当前配置，下次连接即用它。
        case activeNow = "active-now"
        /// 已设为当前配置，但在跑（或正要跑）的隧道用的仍是旧配置，重新连接后才生效。
        case activeAfterReconnect = "active-after-reconnect"
    }

    public enum PrimaryAction: String, Sendable {
        /// 砖要连接：发起连接。
        case connect
        /// 砖要断开：按切换配置那条路重载隧道，让新配置当场生效。
        case useNow = "use-now"
    }

    public enum FailureActions: String, Sendable {
        /// 下载与内容失败：主按钮「重试」，次按钮「返回」。
        case retryOrBack = "retry-or-back"
        /// 启动失败：配置已经存下，再跑一遍流水线只会重下同一份，只给「返回」。
        case backOnly = "back-only"
    }

    public static func of(outcome: ImportOutcome, heroAction: HeroAction) -> ImportConclusion {
        switch heroAction {
        case .connect: .succeeded(outcome: outcome, consequence: .activeNow, primary: .connect)
        case .disconnect: .succeeded(outcome: outcome, consequence: .activeAfterReconnect, primary: .useNow)
        }
    }

    public static func of(error: ImportError) -> ImportConclusion {
        switch error {
        case .downloadHttp, .downloadNetwork, .invalidContent: .failed(.retryOrBack)
        case .startFailed: .failed(.backOnly)
        }
    }
}
