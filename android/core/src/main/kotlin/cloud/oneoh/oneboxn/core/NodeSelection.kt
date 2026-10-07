package cloud.oneoh.oneboxn.core

/**
 * 节点选择投影：把引擎推送的分组集合收敛成 UI 直接消费的平铺列表。
 *
 * 引擎会把模板里的全部 outbound group 都推上来，但用户能选的出口只有出口选择组的成员；
 * 自动组既是一个独立分组、又是出口组的一个成员，故它的当前解析节点要从分组集合里单独取。
 * 两个组 tag 是模板固定值，本文件是它们在全仓的唯一声明处。
 */
data class NodeSelection(
    val nodes: List<Node>,
    val selected: String,
    val autoResolved: String,
) {
    /** 待定的乐观选中：tag + 记下它时的分组推送计数。 */
    data class Optimistic(val tag: String, val generation: Int)

    companion object {
        /** 出口选择组 tag（模板 `outbounds[1]` 的 selector）：用户可选出口的唯一来源。 */
        const val EXIT_GROUP_TAG = "ExitGateway"

        /** 自动选择组 tag（模板 `outbounds[2]` 的 urltest）；同时作为出口组的一个成员出现。 */
        const val AUTO_GROUP_TAG = "auto"

        val EMPTY = NodeSelection(nodes = emptyList(), selected = "", autoResolved = "")

        /**
         * 缺出口选择组即空——合法空态，不回落到「取第一个组」：那会把非出口组的
         * 成员当成可选节点展示。
         */
        fun from(groups: List<NodeGroup>): NodeSelection {
            val exit = groups.firstOrNull { it.tag == EXIT_GROUP_TAG } ?: return EMPTY
            return NodeSelection(
                nodes = exit.nodes,
                selected = exit.now,
                autoResolved = groups.firstOrNull { it.tag == AUTO_GROUP_TAG }?.now.orEmpty(),
            )
        }

        fun isAutoTag(tag: String): Boolean = tag == AUTO_GROUP_TAG

        /**
         * 乐观选中的展示判定：分组推送计数未推进则用乐观值，推进了即用引擎真相。
         *
         * 判据是「引擎又推了一次」而非「选中值变了」——切换未生效时引擎推的恰恰是同一份快照、
         * 选中值不变，比对值会让乐观值永久滞留。
         */
        fun selectedForDisplay(engineSelected: String, optimistic: Optimistic?, groupsGeneration: Int): String =
            if (optimistic != null && optimistic.generation == groupsGeneration) optimistic.tag else engineSelected

        /** 自动节点展示名合成：本地化名由平台传入；尚未解析出实际节点时只显示本地化名。 */
        fun autoLabel(localizedName: String, autoResolved: String): String =
            if (autoResolved.isEmpty()) localizedName else "$localizedName ($autoResolved)"
    }
}
