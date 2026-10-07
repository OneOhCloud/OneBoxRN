package cloud.oneoh.oneboxn.core

/**
 * 热重载失败的诊断合成：诊断在写入时合成，不在读取时择优。
 *
 * 存在的理由：超时 / 结局广播没回来这类**传输层结局**只说明「不知道成没成」，是全链路里信息量
 * 最低的一句；把它直接记成 `lastError` 会把隧道进程写下的真因整个挡在后面——按读取序，
 * 本地记下的那份恒赢，用户复制走的诊断于是只剩一句「reload timeout」，排查无从起步。
 *
 * @param transportDetail 收口处自己知道的事实：传输层结局，可附系统给出的进程退出原因
 *   （诊断阶梯第 3 级）。恒非空——走到这里必有话可说。
 * @param tunnelDiagnosis 隧道进程自己写下的诊断（诊断阶梯第 1 级，经 `Monitor.lastError()` 读出）。
 *   Android 无 iOS 那样的启动阶段标记（第 2 级），故阶梯在此只有两级。
 */
fun reloadDiagnosis(transportDetail: String, tunnelDiagnosis: EngineError?): ReloadDiagnosis =
    ReloadDiagnosis(
        error = EngineError(
            token = "RELOAD_FAILED",
            detail = listOfNotNull(tunnelDiagnosis?.detail, transportDetail)
                .filter { it.isNotEmpty() }
                .joinToString(" — "),
        ),
        // **来源与「哪一级说了话」是同一个判别式**：隧道进程写下了真因 ⇒ 第 1 级 ⇒ 引擎；
        // 一个字都没有 ⇒ 屏上那句话整句是 App 自己的判定（等到点了）⇒ App。
        // 判别式只写在这里：分成「合成详情」与「判来源」两个函数就会有一天只改一个，
        // 而那时详情里是引擎的话、来源那一行写着 App，两行各说各的且没有判据会红。
        source = if (tunnelDiagnosis != null) FailureSource.ENGINE else FailureSource.APP,
    )

/**
 * 合成结果：**详情与来源同出一次决定**，不许分两次算（见上面那条判别式的注释）。
 */
data class ReloadDiagnosis(val error: EngineError, val source: FailureSource)
