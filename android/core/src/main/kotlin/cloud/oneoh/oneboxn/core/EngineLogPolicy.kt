package cloud.oneoh.oneboxn.core

/** 引擎日志进入跨进程传输与应用内缓冲的统一门槛。 */
object EngineLogPolicy {
    val minimumLevel = LogLevel.INFO

    fun accepts(level: LogLevel): Boolean = level >= minimumLevel
}
