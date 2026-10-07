package cloud.oneoh.oneboxn.core

/**
 * 异常的诊断文本：**类型名 + message + cause 链首条**。全仓失败详情的唯一构造口。
 *
 * 不用 `t.message ?: t.javaClass.simpleName`：那个形状会在两种最常见的失败上
 * 把诊断压成无信息量的一句：`UnknownHostException` 的 message 就是裸主机名（用户只看到一个
 * 域名，看不出是 DNS 解析失败），而包装异常的 message 常为空、cause 里才是真因，整条链被丢掉。
 *
 * 与 iOS 同位置的 `String(describing:)` 信息量对齐（那边天然带类型名与关联值）。
 * 只取 cause 链**首条**：再往下多是平台内部帧，收益递减而详情长度会失控。
 */
fun describe(failed: Throwable): String {
    val head = describeSingle(failed)
    val cause = failed.cause ?: return head
    return "$head ← ${describeSingle(cause)}"
}

private fun describeSingle(failed: Throwable): String {
    val type = failed::class.simpleName ?: failed::class.qualifiedName ?: "Throwable"
    val message = failed.message?.trim().orEmpty()
    return if (message.isEmpty()) type else "$type: $message"
}
