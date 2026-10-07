package cloud.oneoh.oneboxn.bridge

import cloud.oneoh.oneboxn.core.EngineStatus

/** 跨广播与 Messenger 回包共享的状态门，确保同值通知不重复触发观察者和注册副作用。 */
internal class EngineStatusState(initial: EngineStatus) {
    private var value = initial

    @Synchronized
    fun current(): EngineStatus = value

    @Synchronized
    fun moveTo(next: EngineStatus): Boolean {
        if (value == next) return false
        value = next
        return true
    }
}
