package cloud.oneoh.oneboxn.tunnel

import cloud.oneoh.oneboxn.core.Engine

/** 线性化启动安装与停止取走，避免迟到的 start 在 stop 之后重新挂回引擎。 */
internal class TunnelEngineLease {
    internal class StartToken internal constructor(internal val generation: Long)

    private data class InstalledEngine(
        val generation: Long,
        val engine: Engine,
    )

    private var nextGeneration = 0L
    private var acceptingGeneration: Long? = null
    private var installedEngine: InstalledEngine? = null

    @Synchronized
    fun beginStart(): StartToken {
        check(installedEngine == null) { "cannot start with an active tunnel engine" }
        nextGeneration += 1
        return StartToken(nextGeneration).also { token ->
            acceptingGeneration = token.generation
        }
    }

    @Synchronized
    fun install(start: StartToken, engine: Engine): Boolean {
        if (!isCurrent(start)) return false
        check(installedEngine == null) { "tunnel engine already installed" }
        installedEngine = InstalledEngine(start.generation, engine)
        return true
    }

    @Synchronized
    fun beginStop(): Engine? {
        acceptingGeneration = null
        return installedEngine?.engine.also { installedEngine = null }
    }

    /** 当前已安装的引擎；未安装则为 null。设备 idle 广播与热重载据此取实例。 */
    @Synchronized
    fun current(): Engine? = installedEngine?.engine

    @Synchronized
    fun isCurrent(start: StartToken): Boolean = acceptingGeneration == start.generation

    @Synchronized
    fun isCurrent(start: StartToken, engine: Engine): Boolean {
        val installed = installedEngine
        return isCurrent(start) &&
            installed?.generation == start.generation &&
            installed.engine === engine
    }
}
