package cloud.oneoh.oneboxn.tunnel

import android.content.Intent

// 隧道进程（:tun）与 UI 进程之间的跨进程信号契约（中立命名，不含内核词汇）。
// 连接真相来自 :tun 服务生命周期广播（以 OS 服务状态为准）。
object TunnelSignals {
    // UI → :tun：请求停止（TunnelService 注册接收）。
    const val ACTION_STOP = "cloud.oneoh.oneboxn.action.TUNNEL_STOP"

    // UI → :tun：请求回放当前服务阶段。UI 进程重建后不能依赖非粘性阶段广播自行恢复。
    const val ACTION_QUERY_STATE = "cloud.oneoh.oneboxn.action.TUNNEL_QUERY_STATE"

    // UI → :tun：请求就地换引擎（热重载）。携一次性配置令牌 + 选核 + 记账归属 + 重载 id。
    // 与 ACTION_STOP 分开而不是加个 extra：两者的结局语义不同——停止的结局是阶段广播，
    // 重载的结局是一次点对点应答（ACTION_RELOAD_RESULT），混在一起会让等待方分不清在等谁。
    const val ACTION_RELOAD = "cloud.oneoh.oneboxn.action.TUNNEL_RELOAD"

    // :tun → UI：重载结局（成功无错误 extra，失败携错误 token/detail）。
    const val ACTION_RELOAD_RESULT = "cloud.oneoh.oneboxn.action.TUNNEL_RELOAD_RESULT"

    // 系统 → :tun：前台服务通知被用户划除。由通知的 deleteIntent 触发，
    // 收到即停止本次会话内的重投——否则 1 Hz 更新会在一秒后把它原样贴回来，用户划不掉。
    // 走既有 controlReceiver 而不是新起一个组件：它已经在 :tun 里，而划除沿的唯一消费者也在那儿。
    const val ACTION_NOTIFICATION_DISMISSED = "cloud.oneoh.oneboxn.action.NOTIFICATION_DISMISSED"

    // :tun → UI：阶段广播（TunnelController / MonitorBinding 注册接收）。
    // **热重载期间不发本广播**：阶段恒为 STARTED，UI 因此不出现任何过渡态。
    const val ACTION_STATE = "cloud.oneoh.oneboxn.action.TUNNEL_STATE"

    // ACTION_STATE 的 extras。
    const val EXTRA_PHASE = "phase" // EngineStatus.name：STARTING/STARTED/STOPPING/STOPPED
    const val EXTRA_ERROR_TOKEN = "error_token"

    /** 失败来源（`FailureSource.token`）。**缺席 = 没记下** ⇒ 读侧占位「—」，不回落。 */
    const val EXTRA_ERROR_SOURCE = "error_source"
    const val EXTRA_ERROR_DETAIL = "error_detail"
    const val EXTRA_QUERY_ID = "query_id"

    /**
     * 本次会话连上的时刻（`SystemClock.elapsedRealtime`，跨进程同一时钟且计入睡眠）。
     * 只随 STARTED 同行：连上那一沿记一次，热重载不发阶段广播也就不会刷新它。
     */
    const val EXTRA_SESSION_STARTED_AT = "session_started_at"

    // 重载请求与其结局的配对 id：迟到的旧结局不得判定新一次重载。
    const val EXTRA_RELOAD_ID = "reload_id"

    // 启动隧道服务时携带的私有配置文件令牌；配置正文不进入 Binder 事务。
    const val EXTRA_CONFIG_TOKEN = "config_token"


    // 用量记账归属：与本次启动所用配置同一次快照捕获。
    // 缺失或空串 = 未归属，该会话不记账（debug 引导配置即此），不是装配 bug，故不 fail-fast。
    const val EXTRA_PROFILE_ID = "profile_id"

    fun queryState(packageName: String): Intent = Intent(ACTION_QUERY_STATE).setPackage(packageName)
}
