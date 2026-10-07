package cloud.oneoh.oneboxn.core

/**
 * 失败详情的多段结构与树形投影。
 *
 * **段与段之间用换行，不用 `—`**：`—` 会出现在段内
 * （「engine start timed out after 20s — the app stopped waiting…」本身就带一个），
 * 拿它当分隔符，读的人分不出哪一处是层级；呈现侧想画成树就只能去猜分隔符，而猜出来的层级会随文案改动悄悄错位。
 * 换行是显式的，且 [join] 与 [parts] 同住一处——两侧各写一份迟早分叉，分叉只在失败那一拍现形。
 *
 * 段的次序即读法：**首段是结局**（宿主确知的那句），其余各段是它的旁证，由近及远。
 *
 * 与 Apple `Core/DiagnosisDetail.swift` 同名。
 * **照搬的是机制，不是语言习惯**：Apple 那份用 `trimmingCharacters(in: .whitespacesAndNewlines)`
 * 与 `components(separatedBy:)`，本端用 `trim()` 与 `split()` —— 两者都在**字符串**这一层切，
 * **不逐字符走**。那条界线是承重的：Swift 的字素簇把 `CRLF` 当一个 `Character`，
 * 而 Kotlin 是两个 UTF-16 码元，**逐字符处理换行必与本端背离**。
 * 按整串切再 `trim` 掉残余的 `\r`，两端结果逐字相同。
 */
object DiagnosisDetail {

    /** 段分隔符。呈现与复制两侧都按它切，不得另立第二个约定。 */
    const val SEPARATOR = "\n"

    /** 合成：空段与纯空白段一律丢弃，不产出空行（空行在复制文本里读起来像诊断被截断了）。 */
    fun join(parts: List<String?>): String =
        parts
            .filterNotNull()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString(SEPARATOR)

    /** 切分。对单段详情恒返回单元素列表——调用方不必为「有没有分段」写两条路径。 */
    fun parts(detail: String): List<String> =
        detail
            .split(SEPARATOR)
            .map { it.trim() }
            .filter { it.isNotEmpty() }

    /**
     * 树形投影（读法同崩溃栈）：首段顶格，其余各段挂在它下面，最后一段用 `└─`。
     *
     * 放在 core 而不是各端 UI 各画一份：**两端画出来的形状必须一致**，否则「同一次失败」
     * 在两端读起来是两件事；而这是纯字符串逻辑，
     * 可被夹具逐字裁。
     */
    fun tree(detail: String): String {
        val all = parts(detail)
        val head = all.firstOrNull() ?: return ""
        val rest = all.drop(1)
        if (rest.isEmpty()) return head
        val branches = rest.mapIndexed { index, part ->
            (if (index == rest.size - 1) "└─ " else "├─ ") + part
        }
        return (listOf(head) + branches).joinToString(SEPARATOR)
    }
}
