package cloud.oneoh.oneboxn.update

import android.content.SharedPreferences
import cloud.oneoh.oneboxn.core.UpdateCheckInput

/** 一次检查由谁发起；冷启动不看排期，必查；手动检查绕过排期，不经 [UpdateCheckStore.input]。 */
internal enum class CheckTrigger { COLD_START, PERIODIC, MANUAL }

/** 检查排期的持久化：上次成功、上次尝试与连续失败次数，交给 core UpdateCheckSchedule 判断是否到点。 */
internal class UpdateCheckStore(private val preferences: SharedPreferences) {

    fun input(nowMillis: Long, trigger: CheckTrigger): UpdateCheckInput = UpdateCheckInput(
        nowMillis = nowMillis,
        lastSuccessMillis = optionalLong(LAST_SUCCESS),
        lastAttemptMillis = optionalLong(LAST_ATTEMPT),
        consecutiveFailures = preferences.getInt(FAILURES, 0),
        coldStart = trigger == CheckTrigger.COLD_START,
    )

    fun recordSuccess(nowMillis: Long) {
        preferences.edit()
            .putLong(LAST_SUCCESS, nowMillis)
            .putLong(LAST_ATTEMPT, nowMillis)
            .putInt(FAILURES, 0)
            .apply()
    }

    fun recordFailure(nowMillis: Long) {
        preferences.edit()
            .putLong(LAST_ATTEMPT, nowMillis)
            .putInt(FAILURES, preferences.getInt(FAILURES, 0) + 1)
            .apply()
    }

    private fun optionalLong(key: String): Long? =
        if (preferences.contains(key)) preferences.getLong(key, 0L) else null

    private companion object {
        const val LAST_SUCCESS = "last_success_millis"
        const val LAST_ATTEMPT = "last_attempt_millis"
        const val FAILURES = "consecutive_failures"
    }
}
