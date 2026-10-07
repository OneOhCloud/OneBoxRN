package cloud.oneoh.oneboxn.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.core.net.toUri
import cloud.oneoh.oneboxn.App
import cloud.oneoh.oneboxn.BuildConfig
import cloud.oneoh.oneboxn.LogSource
import cloud.oneoh.oneboxn.core.LogLevel
import cloud.oneoh.oneboxn.core.UpdateCheckSchedule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

fun createAppUpdater(app: App): AppUpdater = PlayAppUpdater(app)

// 商店版的更新检查：冷启动与周期检查按 core 排期问 Play；Play 是唯一的判定来源，
// 它给不出判定即本次检查失败，按失败退避重试。
internal class PlayAppUpdater(private val app: App) : AppUpdater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val schedule = UpdateCheckStore(app.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE))
    private val checkLock = Mutex()
    private val store = PlayStoreProbe(app) { log(LogLevel.INFO, it) }

    private val mutableState = MutableStateFlow<UpdateState>(UpdateState.None)
    override val state: StateFlow<UpdateState> = mutableState.asStateFlow()

    private val mutableCheckStatus = MutableStateFlow(UpdateCheckStatus.IDLE)
    override val checkStatus: StateFlow<UpdateCheckStatus> = mutableCheckStatus.asStateFlow()

    override fun scheduleChecks() {
        UpdateWorker.enqueue(app)
        scope.launch {
            awaitColdStartCheckTurn(app.uiForeground)
            checkWhenDue(CheckTrigger.COLD_START)
        }
    }

    /** 到点才查；周期任务与冷启动走这里。 */
    suspend fun checkWhenDue(trigger: CheckTrigger) {
        checkLock.withLock {
            val now = System.currentTimeMillis()
            val plan = UpdateCheckSchedule.plan(schedule.input(now, trigger))
            if (!plan.due) {
                log(LogLevel.DEBUG, "check not due until ${plan.nextCheckAtMillis}")
                return
            }
            performCheck(now, trigger, beforeReveal = {})
        }
    }

    override fun checkNow() {
        if (checkStatus.value == UpdateCheckStatus.CHECKING) return
        val tappedAt = SystemClock.elapsedRealtime()
        mutableCheckStatus.value = UpdateCheckStatus.CHECKING
        scope.launch {
            checkLock.withLock {
                performCheck(System.currentTimeMillis(), CheckTrigger.MANUAL) {
                    awaitMinimumCheckVisibility { SystemClock.elapsedRealtime() - tappedAt }
                }
            }
        }
    }

    /** [beforeReveal] 在结果写回状态之前挂起：手动检查借它等满最短可见时长，结果文字与旋转停止同一拍出现。 */
    private suspend fun performCheck(now: Long, trigger: CheckTrigger, beforeReveal: suspend () -> Unit) {
        mutableCheckStatus.value = UpdateCheckStatus.CHECKING
        val verdict = store.verdict()
        beforeReveal()
        when (verdict) {
            is StoreVerdict.UpdateAvailable -> {
                schedule.recordSuccess(now)
                mutableState.value = UpdateState.Available(verdict.build)
                mutableCheckStatus.value = UpdateCheckStatus.IDLE
            }
            StoreVerdict.UpToDate -> {
                schedule.recordSuccess(now)
                mutableState.value = UpdateState.None
                mutableCheckStatus.value = UpdateCheckStatus.UP_TO_DATE
            }
            StoreVerdict.Unreachable -> {
                // 失败不撤回已有的提示：上一轮查到的新版本仍然成立。不可达的缘由已由探针记下。
                schedule.recordFailure(now)
                mutableCheckStatus.value = UpdateCheckStatus.FAILED
                return
            }
        }
        log(LogLevel.INFO, "check ($trigger): installed ${BuildConfig.VERSION_CODE}, verdict $verdict")
    }

    override fun openUpdate(host: Context) {
        // 按钮显示后、点下前，周期检查可能已把提示撤回：这是正常竞态，不是非法状态。
        if (state.value !is UpdateState.Available) {
            log(LogLevel.INFO, "open update ignored: offer withdrawn")
            return
        }
        openStorePage(host)
    }

    /** 商店应用在检查之后被停用时没有谁接 market: 链接，改走商店网页。 */
    private fun openStorePage(host: Context) {
        val market = Intent(Intent.ACTION_VIEW, "market://details?id=${app.packageName}".toUri())
            .setPackage(PLAY_STORE_PACKAGE)
        try {
            host.startActivity(market)
        } catch (_: ActivityNotFoundException) {
            log(LogLevel.INFO, "store app unavailable, opening the store web page")
            host.startActivity(
                Intent(Intent.ACTION_VIEW, "https://play.google.com/store/apps/details?id=${app.packageName}".toUri()),
            )
        }
    }

    private fun log(level: LogLevel, message: String) {
        app.logStore.append(LogSource.APP, level, "update: $message")
    }

    private companion object {
        const val PREFERENCES_NAME = "update-check"
        const val PLAY_STORE_PACKAGE = "com.android.vending"
    }
}
