package cloud.oneoh.oneboxn.tunnel

import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.NodeSelection
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.core.TrafficFormat

/**
 * 前台服务通知的呈现值。
 *
 * 纯数据：只把既有观察帧收敛成「该显示哪几行、各行的数值文本是什么」，不碰本地化、不碰平台 API。
 * 本地化拼装留给 [ServiceNotification]（它有 Context）；数值一律经 core 的 [TrafficFormat]，
 * 节点 tag 一律经 core 的 [NodeSelection]——两者都是全仓单一来源。
 *
 * 相等即「渲染出来逐字相同」，故它同时是主闸（内容相等就不投递）的判据。
 */
internal data class NotificationContent(
    /** 选中节点的 tag；null = 尚无可显示的节点，标题回落。 */
    val nodeTag: String?,
    /** 自动组当前解析到的节点 tag（合成展示名要用）。 */
    val autoResolved: String,
    /** null = 那一拍根本没有快照（首帧未到 / 已离开 STARTED），整段数字不呈现。 */
    val figures: Figures?,
) {
    /** 已格式化、未本地化的数值文本。 */
    internal data class Figures(
        val downRate: String,
        val upRate: String,
        val downTotal: String,
        val upTotal: String,
    )

    internal companion object {
        /**
         * 无数据形态（首帧之前、离开 STARTED 之后）：只剩回落标题。
         *
         * 这不是把 0 改写成「—」（那是不允许的），而是那一拍确实没有快照可读。
         */
        val IDLE = NotificationContent(nodeTag = null, autoResolved = "", figures = null)

        fun of(traffic: Traffic?, groups: List<NodeGroup>): NotificationContent {
            val selection = NodeSelection.from(groups)
            return NotificationContent(
                nodeTag = selection.selected.ifEmpty { null },
                autoResolved = selection.autoResolved,
                figures = traffic?.let {
                    Figures(
                        downRate = TrafficFormat.rate(it.down),
                        upRate = TrafficFormat.rate(it.up),
                        downTotal = TrafficFormat.bytes(it.downTotal),
                        upTotal = TrafficFormat.bytes(it.upTotal),
                    )
                },
            )
        }
    }
}
