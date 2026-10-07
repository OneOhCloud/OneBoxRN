package cloud.oneoh.oneboxn.update

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.InstallException
import com.google.android.play.core.install.model.UpdateAvailability
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout

/** 商店对本应用更新的判定；没有商店、接口报错或超时都给不出判定，一律 [Unreachable]。 */
internal sealed interface StoreVerdict {
    /** 商店只给目标构建号，没有营销版本名。 */
    data class UpdateAvailable(val build: Long) : StoreVerdict

    data object UpToDate : StoreVerdict

    data object Unreachable : StoreVerdict
}

/**
 * 问 Play 本应用有没有更新。只读判定，不走应用内更新流程：有更新时把用户带去商店页，由商店完成更新。
 * 商店给不出判定时 Task 以失败收场：接口报错是 InstallException，没装商店时是库内部绑定服务失败的
 * RuntimeException（非公开类型）。只有 Task 失败回调送来的异常算「商店不可达」，本仓自己的异常照常上抛。
 * Task 本身没有超时，自己加一道。
 */
internal class PlayStoreProbe(context: Context, private val log: (String) -> Unit) {
    private val manager = AppUpdateManagerFactory.create(context)

    suspend fun verdict(): StoreVerdict {
        val info = try {
            withTimeout(STORE_TIMEOUT_MILLIS) { manager.appUpdateInfo.await() }
        } catch (failure: StoreTaskFailure) {
            log("store unreachable: ${storeFailureDescription(failure.reason)}")
            return StoreVerdict.Unreachable
        } catch (_: TimeoutCancellationException) {
            log("store unreachable: no answer within ${STORE_TIMEOUT_MILLIS}ms")
            return StoreVerdict.Unreachable
        }
        return when (val availability = info.updateAvailability()) {
            UpdateAvailability.UPDATE_AVAILABLE -> StoreVerdict.UpdateAvailable(build = info.availableVersionCode().toLong())
            UpdateAvailability.UPDATE_NOT_AVAILABLE -> StoreVerdict.UpToDate
            UpdateAvailability.UNKNOWN -> {
                log("store unreachable: availability unknown")
                StoreVerdict.Unreachable
            }
            // 本应用从不发起应用内更新，「开发者发起的更新进行中」不该出现。
            else -> error("unexpected store update availability $availability")
        }
    }

    private companion object {
        const val STORE_TIMEOUT_MILLIS = 10_000L
    }
}

/**
 * 库的异常类型经过混淆，`toString()` 只会带出 `o70:` 这类无意义类名，日志只留消息；
 * 接口报错没有消息时留它的错误码，别的异常没有消息就只说没有消息。
 */
internal fun storeFailureDescription(failure: Exception): String =
    failure.message?.takeIf { it.isNotBlank() }
        ?: (failure as? InstallException)?.let { "install error code ${it.errorCode}" }
        ?: "no message"

private class StoreTaskFailure(val reason: Exception) : Exception(reason)

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(StoreTaskFailure(it)) }
}
