package cloud.oneoh.oneboxn.core

/**
 * 首页电源砖此刻按下去会做什么（由砖的状态推出，在首页那一层）。导入结论页的主按钮与它同一语义：
 * 手动导入不重载隧道，砖要断开时（已连接、连接中）隧道在跑或正要跑，跑的仍是旧配置。
 */
enum class HeroAction { CONNECT, DISCONNECT }

/**
 * 导入结束那一页的判定：成功时后果怎么说、主按钮给什么；失败时能不能重试。只给判定、不给文案。
 * golden/import-conclusion.json 是两端裁判（Apple Core/ImportConclusion.swift）。
 *
 * 进行中与自动应用不在这里：前者还没有结论，后者直接回首页，没有结论页。
 */
sealed interface ImportConclusion {
    /** 结论跟结局走（新增 → 导入成功，更新 → 配置已更新）；后果与主按钮跟电源砖此刻的动作走。次按钮恒为「完成」，不进判定。 */
    data class Succeeded(val outcome: ImportOutcome, val consequence: Consequence, val primary: PrimaryAction) : ImportConclusion

    data class Failed(val actions: FailureActions) : ImportConclusion

    enum class Consequence {
        /** 已设为当前配置，下次连接即用它。 */
        ACTIVE_NOW,

        /** 已设为当前配置，但在跑（或正要跑）的隧道用的仍是旧配置，重新连接后才生效。 */
        ACTIVE_AFTER_RECONNECT,
    }

    enum class PrimaryAction {
        /** 砖要连接：发起连接。 */
        CONNECT,

        /** 砖要断开：按切换配置那条路重载隧道，让新配置当场生效。 */
        USE_NOW,
    }

    enum class FailureActions {
        /** 下载与内容失败：主按钮「重试」，次按钮「返回」。 */
        RETRY_OR_BACK,

        /** 启动失败：配置已经存下，再跑一遍流水线只会重下同一份，只给「返回」。 */
        BACK_ONLY,
    }

    companion object {
        fun of(outcome: ImportOutcome, heroAction: HeroAction): ImportConclusion = when (heroAction) {
            HeroAction.CONNECT -> Succeeded(outcome, Consequence.ACTIVE_NOW, PrimaryAction.CONNECT)
            HeroAction.DISCONNECT -> Succeeded(outcome, Consequence.ACTIVE_AFTER_RECONNECT, PrimaryAction.USE_NOW)
        }

        fun of(error: ImportError): ImportConclusion = when (error) {
            is ImportError.DownloadHttp, is ImportError.DownloadNetwork, is ImportError.InvalidContent ->
                Failed(FailureActions.RETRY_OR_BACK)
            is ImportError.StartFailed -> Failed(FailureActions.BACK_ONLY)
        }
    }
}
