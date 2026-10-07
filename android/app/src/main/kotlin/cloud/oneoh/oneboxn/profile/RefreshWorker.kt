package cloud.oneoh.oneboxn.profile

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import cloud.oneoh.oneboxn.App
import java.util.concurrent.TimeUnit

// 后台自动更新配置的 Android 载体。
// 与 UI 同进程、共用同一个 ProfileStore，故写回直接发生，无结果槽。
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // 全部 profile 串行逐个；领域失败不抛出（静默），故这里恒 success——
        // 重试由下一个周期承担，WorkManager 的退避重试会与周期语义打架。
        (applicationContext as App).actions.refreshAllProfiles()
        return Result.success()
    }

    companion object {
        private const val UNIQUE_NAME = "config-refresh"
        private const val PERIOD_SECONDS = 1800L

        /**
         * 这一次进程启动是**谁**发起的。**用枚举而不是两个布尔**，与 `AboutSheet` 的 `TunnelState`
         * 同一取向：调用点写 `TunnelState.RUNNING` 读得出是哪一态，写 `running = true` 只读得出某个开关是真。
         */
        enum class LaunchContext { USER, ENGINE_PROCESS, INSTRUMENTATION }

        /**
         * 这一次启动**该不该**动周期任务的排期。
         *
         * **instrumentation 返回 `false` 而不是「注销」**：测试宿主既不该排它，
         * 也不该把用户已经排好的那一条掐掉——那同样是测试运行改写了生产状态。
         *
         * 这一条在 Android 上比 Apple 更要紧：Apple 的 XPC 活动止于那一次测试运行；而本端排进的是
         * WorkManager 的持久化数据库，它跨进程死亡、跨重启存活——跑一次测试，此后一直抓。
         */
        fun shouldTouchSchedule(context: LaunchContext): Boolean = context == LaunchContext.USER

        /**
         * 这一次启动落在哪一档。**优先级是硬的**：instrumentation 先于进程判定 ——
         * 测试宿主跑在主进程里，先判进程会让它落进 `USER`。
         */
        fun launchContext(processName: String?, packageName: String, runner: String?): LaunchContext =
            when {
                runner != null -> LaunchContext.INSTRUMENTATION
                processName == packageName -> LaunchContext.USER
                else -> LaunchContext.ENGINE_PROCESS
            }

        /**
         * 此刻类路径上的 instrumentation runner，没有则 `null`。
         *
         * **判据免费可得，不新造通道**：instrumentation 跑时，测试 APK 与被测 APK
         * **共用同一个 classloader**，故 runner 类此刻在类路径上；生产 APK 里它不存在。
         * 这里 `catch` 的不是「出错」而是**判据本身**（类不在 = 不是测试），不是吞错。
         * 类名与 `app/build.gradle.kts` 的 `testInstrumentationRunner` 是**同一个值的两处**——
         * 换 runner 要同笔改这里，否则本判据静默恒 `null`。
         */
        fun instrumentationRunner(): String? =
            try {
                Class.forName(INSTRUMENTATION_RUNNER).name
            } catch (absent: ClassNotFoundException) {
                null
            }

        private const val INSTRUMENTATION_RUNNER = "androidx.test.runner.AndroidJUnitRunner"

        /** 开关为开则注册（幂等，已在则保留既有排期），为关则注销。 */
        fun sync(context: Context, enabled: Boolean) {
            val manager = WorkManager.getInstance(context)
            if (!enabled) {
                manager.cancelUniqueWork(UNIQUE_NAME)
                return
            }
            manager.enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                // KEEP 而非 UPDATE：每次冷启动都重排会让周期永远等不满，任务实际上不再触发。
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<RefreshWorker>(PERIOD_SECONDS, TimeUnit.SECONDS)
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build(),
                    )
                    .build(),
            )
        }
    }
}
