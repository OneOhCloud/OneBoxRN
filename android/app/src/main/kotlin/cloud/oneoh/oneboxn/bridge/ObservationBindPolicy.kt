package cloud.oneoh.oneboxn.bridge

import cloud.oneoh.oneboxn.core.EngineStatus

// 观察 bind 会话化的纯决策:bind 与隧道会话同生命周期,不与 handler 挂载同步。
// 宿主喂入相位/挂载沿与到期回执,拿回命令自行执行(bindService、postDelayed 等副作用全在宿主)。
internal class ObservationBindPolicy {

    /**
     * [REBIND] 是「换一条绑定」而不是 [UNBIND] + [BIND] 两条命令：后者会让 [bound] 在中间落回 false，
     * 于是任何插进来的相位输入都会再发一条 BIND，最终绑出两条。要的是**至多一条重建在途**。
     */
    enum class Command { BIND, UNBIND, SCHEDULE_UNBIND, CANCEL_UNBIND, REBIND }

    private var bound = false
    private var unbindScheduled = false

    fun onPhase(phase: EngineStatus): List<Command> {
        val sessionActive = phase != EngineStatus.STOPPED
        return when {
            sessionActive && !bound -> {
                bound = true
                if (unbindScheduled) {
                    unbindScheduled = false
                    listOf(Command.CANCEL_UNBIND, Command.BIND)
                } else {
                    listOf(Command.BIND)
                }
            }
            sessionActive && unbindScheduled -> {
                unbindScheduled = false
                listOf(Command.CANCEL_UNBIND)
            }
            !sessionActive && bound && !unbindScheduled -> {
                unbindScheduled = true
                listOf(Command.SCHEDULE_UNBIND)
            }
            else -> emptyList()
        }
    }

    // 宿主延迟到期回执。取消与到期竞态时(已取消后迟到)不解绑——竞态语义,非吞错。
    fun onUnbindDelayElapsed(): List<Command> {
        if (!unbindScheduled) return emptyList()
        unbindScheduled = false
        bound = false
        return listOf(Command.UNBIND)
    }

    /**
     * 绑定永久死亡（`onBindingDied`）：系统**不会**自动恢复，必须解绑后重绑。
     *
     * 与 `onServiceDisconnected` 不是一回事——后者是服务进程死了而绑定仍在，系统会在服务回来时
     * 自动回调 `onServiceConnected`，那时只该清「已注册」标志，解绑重绑反而把系统的自愈打断。
     */
    fun onBindingDied(): List<Command> {
        if (!bound) return emptyList()
        return listOf(Command.REBIND)
    }

    /**
     * `onBind` 返回了 null：这次绑定不会有服务，必须解绑；**不**原地重试——
     * 同一次绑定不会自己变好，重来要等下一个会话相位上升沿。
     */
    fun onNullBinding(): List<Command> {
        if (!bound) return emptyList()
        bound = false
        unbindScheduled = false
        return listOf(Command.UNBIND)
    }

    /**
     * 已绑定且已注册，但帧长时间不到（断流）。
     *
     * 现有状态机在 [bound] 为 true 时不会再发 BIND，故只加一个 stale 输入并不足以让它重建——
     * 这正是要有 [Command.REBIND] 的原因。Android 侧没有 Apple 那种「端点还在不在」的独立判据，
     * 绑定就是通道本身，故重绑是这里唯一可用的恢复杠杆。
     */
    fun onFramesStale(): List<Command> {
        if (!bound) return emptyList()
        return listOf(Command.REBIND)
    }

    /**
     * 宿主的 `bindService` 返回了 false：系统认为建不成有效连接，而策略侧在发出
     * `BIND` 时已把 [bound] 置为 true——不回退的话两份 bound 就此分裂，同一个 STARTED 会话内
     * 再也不会发第二条 BIND，通道永久缺席且无人知情。
     */
    fun onBindFailed(): List<Command> {
        bound = false
        unbindScheduled = false
        return emptyList()
    }

    // detach 即会话观察收尾:取消在途延迟并立即解绑(沿用「detach 与 close 等价」契约)。
    fun onDetach(): List<Command> {
        val commands = buildList {
            if (unbindScheduled) add(Command.CANCEL_UNBIND)
            if (bound) add(Command.UNBIND)
        }
        unbindScheduled = false
        bound = false
        return commands
    }

    companion object {
        // STOPPED 后延迟解绑,吸收快速重连抖动(单一来源)。
        const val UNBIND_DELAY_MILLIS = 10_000L
    }
}
