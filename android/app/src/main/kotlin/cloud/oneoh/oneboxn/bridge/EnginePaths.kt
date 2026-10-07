package cloud.oneoh.oneboxn.bridge

import android.content.Context
import java.io.File

// 引擎运行所需的目录（中立、无内核依赖）。base/working/temp 三处路径是 UI 与 :tun
// 两进程的唯一来源——两端用同一 basePath，命令 socket 落在同一位置才能跨进程连通。
object EnginePaths {
    /** 命令 socket / 持久数据的根，两进程必须一致。 */
    fun base(context: Context): File = context.filesDir.also { it.mkdirs() }

    /** 运行期工作目录（崩溃输出、启动错误快照）。 */
    fun working(context: Context): File = File(context.filesDir, "engine").also { it.mkdirs() }

    /** 临时目录。 */
    fun temp(context: Context): File = context.cacheDir.also { it.mkdirs() }

    /** 启动失败诊断文件（:tun 写、UI 读，跨进程错误通道之一）。 */
    fun startError(context: Context): File = File(working(context), "start_error.txt")
}
