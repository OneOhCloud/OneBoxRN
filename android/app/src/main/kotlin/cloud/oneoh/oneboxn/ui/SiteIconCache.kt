package cloud.oneoh.oneboxn.ui

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import cloud.oneoh.oneboxn.core.SiteIconEntry
import cloud.oneoh.oneboxn.net.SiteIconFetcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async

/**
 * 站点图标的进程内缓存（iOS 对等物 App/UI/SiteIconCache.swift）：按图标地址记住「取到的图」或「取不到」，
 * 成功与失败都不再重打；同一地址在途时，后来者等同一个请求，不另发。
 *
 * 抓取跑在 [scope] 里而不是调用方的协程里：打开详情又立刻收起，调用方那一侧的取消不会把这一次记成「取不到」。
 * 只在主线程读写（Compose 的组合与 `LaunchedEffect` 都在主线程），[scope] 也须派发到主线程。
 */
class SiteIconCache<I>(
    private val fetch: suspend (String) -> ByteArray?,
    private val decode: (ByteArray) -> I?,
    private val scope: CoroutineScope,
) {
    private val entries = mutableMapOf<String, SiteIconEntry<I>>()
    private val pending = mutableMapOf<String, Deferred<SiteIconEntry<I>>>()

    /** 已有的结局：首帧直接用它，免得每次打开详情都先闪一下回落图标。还没取过 → null。 */
    fun known(address: String): SiteIconEntry<I>? = entries[address]

    suspend fun entry(address: String): SiteIconEntry<I> {
        entries[address]?.let { return it }
        // 惰性启动：先登记在途、再开跑，立即派发的调度器上也不会先跑完再登记、留下一个过期的在途。
        return pending.getOrPut(address) { scope.async(start = CoroutineStart.LAZY) { settle(address) } }.await()
    }

    private suspend fun settle(address: String): SiteIconEntry<I> {
        val entry = fetch(address)?.let(decode)?.let { SiteIconEntry.Icon(it) } ?: SiteIconEntry.Unavailable
        entries[address] = entry
        pending.remove(address)
        return entry
    }
}

/** 进程唯一的那一份：详情每次打开都读它，结局跨详情存活。 */
val siteIconCache: SiteIconCache<ImageBitmap> by lazy {
    SiteIconCache(
        fetch = SiteIconFetcher()::fetch,
        decode = { bytes -> BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() },
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
    )
}
