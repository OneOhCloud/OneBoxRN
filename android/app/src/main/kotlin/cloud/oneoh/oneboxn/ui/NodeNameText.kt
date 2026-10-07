package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.NodeSelection

// 节点显示名：自动组是模板固定 tag，向用户显示本地化名而非裸 tag；
// 其余 tag 由服务端下发，原样显示不翻译。节点弹层行、会话卡与前台服务通知共用此处
// （iOS 对等物 NodeNameText.swift）。
//
// 判据本身是非 Compose 的：:tun 进程的通知渲染取不到 Composable，而这条规则在 Android 端
// 只允许有一份实现。故规则落在 nodeDisplayName，Composable 只负责取本地化串。
fun nodeDisplayName(tag: String, autoResolved: String, autoName: String): String {
    if (!NodeSelection.isAutoTag(tag)) return tag
    return NodeSelection.autoLabel(autoName, autoResolved)
}

@Composable
fun nodeNameText(tag: String, autoResolved: String): String =
    nodeDisplayName(tag, autoResolved, stringResource(R.string.nodes_auto))

/**
 * 节点名在屏上的两段。自动组拆成「实际出口」与「自动选择」两行：
 * 连成一行时括号把名字撑长，一截断先丢的就是括号里的实际出口。
 */
data class NodeNameLines(
    /** 手选节点名，或自动组此刻的实际出口；自动组尚未解析出出口时就是「自动选择」本身。 */
    val name: String,
    /** 自动组且已解析出出口时才有：「自动选择」这一小行。 */
    val autoCaption: String?,
) {
    /** 读屏读完整名称：先说是自动选择，再说出口。 */
    val spoken: List<String> get() = listOfNotNull(autoCaption, name)

    companion object {
        fun of(tag: String, autoResolved: String, autoName: String): NodeNameLines {
            if (!NodeSelection.isAutoTag(tag) || autoResolved.isEmpty()) {
                return NodeNameLines(name = nodeDisplayName(tag, autoResolved, autoName), autoCaption = null)
            }
            return NodeNameLines(name = autoResolved, autoCaption = autoName)
        }
    }
}

@Composable
fun nodeNameLines(tag: String, autoResolved: String): NodeNameLines =
    NodeNameLines.of(tag, autoResolved, stringResource(R.string.nodes_auto))
