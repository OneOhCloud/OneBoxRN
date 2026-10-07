package cloud.oneoh.oneboxn.update

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import cloud.oneoh.oneboxn.App
import cloud.oneoh.oneboxn.core.UpdateCheckSchedule
import java.util.concurrent.TimeUnit

// 周期检查更新的载体，与配置刷新的 RefreshWorker 互不相干：两者开关、周期与失败语义都不同。
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // 恒 success：失败退避由 UpdateCheckSchedule 持有，WorkManager 的重试会与它打架。
        ((applicationContext as App).updater as PlayAppUpdater).checkWhenDue(CheckTrigger.PERIODIC)
        return Result.success()
    }

    companion object {
        private const val UNIQUE_NAME = "update-check"

        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                // KEEP：每次冷启动都重排会让周期永远等不满。
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<UpdateWorker>(UpdateCheckSchedule.PERIOD_MILLIS, TimeUnit.MILLISECONDS)
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
