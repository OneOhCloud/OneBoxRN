package cloud.oneoh.oneboxn.vpn

import cloud.oneoh.oneboxn.core.EngineError
import cloud.oneoh.oneboxn.core.FailureSource

/**
 * 启动失败诊断与其观察时刻的不可分对。
 *
 * 为什么必须是一个值而不是并列两条流：Android 侧诊断逐层经 `StateFlow` 发布，拆成两条流后
 * 「错误已到、时刻未到」是**可观察的中间态**——失败弹层恰在 `lastError` 由空转非空的那一刻
 * 快照时刻并从此定格，取到还没跟上的 null 就把在线失败永久显示成「无可信时刻」的「—」。
 * 合成一个值后，中间态在类型上就不存在。
 *
 * iOS 无此形态：两个字段在同一个 MainActor 块内写入、读侧也在 MainActor，天然成对。
 *
 * [occurredAtMillis] 为 null = 无可信时刻（挂载读到的历史诊断，占位「—」）。
 *
 * [source] 为 null = **没记下来源**。与时刻同处置：占位「—」，
 * **不回落到任何一个具体来源** —— 无条件写「引擎事件」就是给来源不明的错误编一个来源。
 * 来源与诊断同属一个值，理由与时刻那条相同：拆开就会有「错误已到、来源未到」的中间态。
 */
data class FailureDiagnostic(
    val error: EngineError,
    val occurredAtMillis: Long?,
    val source: FailureSource?,
)
