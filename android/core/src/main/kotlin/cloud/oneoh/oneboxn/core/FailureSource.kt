package cloud.oneoh.oneboxn.core

/**
 * 失败诊断的来源。
 *
 * **由登记方在写入时记下，呈现侧只读不猜。** 来源阶梯里只有第 1 级是引擎：
 * 超时 / 合并失败 / 缺授权都是 App 自己的判定，系统拒绝拉起隧道进程是操作系统给的。
 * 一律标成「引擎事件」的话，「App 等了 20 秒不等了」会被标成引擎报的——
 * 用户按那一行去查引擎，而引擎没有问题。
 *
 * 没记下时**不得回落到任何一个具体来源**：按弹层 MetaRow 的既有规则占位「—」，不编造。
 *
 * 与 Apple 侧 `Core/FailureSource.swift` 逐 case 同名同 token；
 * 两端须手工保持同集：`golden` 只判「已声明的夹具 × 已声明的平台」，判不出某一端多一个或少一个 case。
 * `TUNNEL` 在本端**结构上不会发生**（Android 的隧道进程是同 app 内的 `:tun` 服务，
 * 第 2 级由第 3 级完整覆盖）——**它仍然要在这个枚举里**：
 * 这是两端共用的词表，少一个 case 会让 `fromToken` 在收到另一端记下的值时判不出来，
 * 而那读起来会是「来源坏了」而不是「本端没有这一级」。
 */
enum class FailureSource(val token: String) {
    /** 引擎自己报的（阶梯第 1 级，或运行期经观察通道推来的失败）。 */
    ENGINE("engine"),

    /** 隧道进程留下的痕迹，但引擎没说话（阶梯第 2 级：阶段标记）。**本端结构上不产生它**，见类注释。 */
    TUNNEL("tunnel"),

    /** 本进程自己的判定：启动预算到点、合并失败、缺授权。 */
    APP("app"),

    /**
     * 操作系统给的（阶梯第 3 级）——含「系统拒绝拉起隧道进程」那一类。
     *
     * 载荷**必须带域与码**（Apple 如 `NEVPNErrorDomain code=5`，Android 如 `reason=CRASH_NATIVE(5)`），
     * 不只写本地化描述：描述随系统语言与厂商变，码才可检索、可跨机器比对。
     */
    SYSTEM("system"),

    /** 诊断通道自己坏了——既不是原因也不是阶段，而是「问不出来」。 */
    DIAGNOSTICS("diagnostics"),

    ;

    companion object {
        /** 认不出来的 token 返回 null（⇒ 占位「—」），**不回落到任何一个具体来源**。 */
        fun fromToken(token: String?): FailureSource? = entries.firstOrNull { it.token == token }
    }
}
