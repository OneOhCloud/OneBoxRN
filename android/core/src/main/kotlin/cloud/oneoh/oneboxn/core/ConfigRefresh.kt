package cloud.oneoh.oneboxn.core

import kotlin.coroutines.cancellation.CancellationException

// 刷新写回管线：手动与后台刷新共用的唯一实现。
// 错误面 = 导入三类（DownloadHttp/DownloadNetwork/InvalidContent）；刷新无启动步，StartFailed 不可达。
// 与 iOS Core/ConfigRefresh.swift 逐字对应，golden/config-refresh.json 是行为裁判。

sealed interface RefreshOutcome {
    data class Updated(val info: TrafficInfo, val contentChanged: Boolean) : RefreshOutcome

    /** 来源 url 已无对应 profile：零写入。 */
    data object Dropped : RefreshOutcome

    data class Failed(val error: ImportError) : RefreshOutcome
}

class ConfigRefresh(
    private val fetcher: ConfigFetcher,
    private val store: ProfileStore,
    private val userAgent: () -> String,
    private val now: () -> Long,
) {
    /** 写回不变量：结果只写来源 url 对应的 profile；不改名、不改激活、不触碰隧道。取消异常原样上抛。 */
    suspend fun run(url: String): RefreshOutcome {
        val reply = try {
            fetcher.fetch(url, userAgent())
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (transport: Exception) {
            // 外部传输失败在端口边界转类型化领域错误；诊断文本与 ImportFlow 同源。
            return RefreshOutcome.Failed(ImportError.DownloadNetwork(describe(transport)))
        }
        if (reply.status !in 200..299) return RefreshOutcome.Failed(ImportError.DownloadHttp(reply.status))
        val verdict = ConfigCheck.validate(reply.body)
        if (verdict is ConfigVerdict.Invalid) return RefreshOutcome.Failed(ImportError.InvalidContent(verdict.reason))
        val info = Userinfo.parse(reply.header(Userinfo.HEADER))
        val metadata = RefreshedMetadata(
            info = info,
            updatedAt = now(),
            website = ProfileWebsite.parse(reply.header(ProfileWebsite.HEADER)),
        )
        return when (val write = store.applyRefresh(url, metadata, reply.body)) {
            is RefreshWrite.Applied -> RefreshOutcome.Updated(info, write.contentChanged)
            RefreshWrite.Dropped -> RefreshOutcome.Dropped
        }
    }
}
