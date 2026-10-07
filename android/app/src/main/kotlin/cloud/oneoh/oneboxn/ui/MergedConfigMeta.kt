package cloud.oneoh.oneboxn.ui

import cloud.oneoh.oneboxn.core.ConfigMerge
import cloud.oneoh.oneboxn.core.Json
import cloud.oneoh.oneboxn.core.JsonValue

// 合并输出的展示派生（唯一实现；镜像 iOS App/UI/MergedConfigMeta.swift）：
// 配置查看页元信息（+N 出站 · DNS）与设置页 DNS 行共用。输入必须是本仓合并器（单一实现）
// 的产物——严格 JSON 已由合并器保证；解析失败即不变量破坏 → 崩溃暴露，不做防御兜底。
data class MergedConfigMeta(
    /** 注入的节点出站数：按合并器的组/功能型类型集（单一来源）取反计数。 */
    val injectedOutboundCount: Int,

    /** 合并改写后的 system DNS 服务器；模板无 system 项时为 null（改写为空操作）。 */
    val systemDns: String?,
) {
    companion object {
        fun parse(mergedText: String): MergedConfigMeta {
            val root = Json.parse(mergedText) as? JsonValue.JsonObject
                ?: error("merged config is not a JSON object — merge invariant broken")
            return MergedConfigMeta(
                injectedOutboundCount = injectedOutboundCount(root),
                systemDns = systemDns(root),
            )
        }

        private fun injectedOutboundCount(root: JsonValue.JsonObject): Int {
            val outbounds = root.get("outbounds") as? JsonValue.JsonArray
                ?: error("merged config missing outbounds array — merge invariant broken")
            return outbounds.items.count { item ->
                val type = ((item as? JsonValue.JsonObject)?.get("type") as? JsonValue.JsonString)?.value
                type != null && type !in ConfigMerge.EXCLUDED_OUTBOUND_TYPES
            }
        }

        private fun systemDns(root: JsonValue.JsonObject): String? {
            val servers = (root.get("dns") as? JsonValue.JsonObject)
                ?.get("servers") as? JsonValue.JsonArray ?: return null
            for (item in servers.items) {
                val server = item as? JsonValue.JsonObject ?: continue
                if ((server.get("tag") as? JsonValue.JsonString)?.value == "system") {
                    return (server.get("server") as? JsonValue.JsonString)?.value
                }
            }
            return null
        }
    }
}
