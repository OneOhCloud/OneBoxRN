package cloud.oneoh.oneboxn.core

import kotlin.coroutines.cancellation.CancellationException

// 导入流水线：从 ImportPayload 到「profile 已存储并激活
// （以及 apply 时隧道已启动）」的直线序。每相位先 onPhase 再执行，终态也经 onPhase 后返回。
// 失败为四类领域错误（ImportError）；调用方取消原样上抛，不映射为领域错误。
// 与 iOS Core/ImportFlow.swift 逐字对应，golden/import-flow.json 是行为裁判。

sealed interface ImportError {
    /** 稳定 token：golden 相位轨迹与终态断言用；i18n 文案在 UI 层映射。 */
    val token: String

    /** HTTP 非 2xx。 */
    data class DownloadHttp(val statusCode: Int) : ImportError {
        override val token: String get() = "download-http:$statusCode"
    }

    /** 传输层失败（超时/DNS/TLS/断网）：message 承载原始诊断供失败视图呈现。 */
    data class DownloadNetwork(val message: String) : ImportError {
        override val token: String get() = "download-network"
    }

    /** 内容校验拒绝。 */
    data class InvalidContent(val reason: ContentReject) : ImportError {
        override val token: String get() = "invalid-content:" + when (reason) {
            ContentReject.EMPTY -> "empty"
            ContentReject.NOT_JSON -> "not-json"
            ContentReject.NOT_OBJECT -> "not-object"
        }
    }

    /** 启动失败/超时：message 承载引擎诊断；已存储的 profile 不回滚。 */
    data class StartFailed(val message: String) : ImportError {
        override val token: String get() = "start-failed"
    }
}

/** 这一次导入往列表里写的是新的一份，还是同一链接的那一份换了新内容。判据是导入前列表里有没有同一 URL。 */
enum class ImportOutcome { ADDED, UPDATED }

/**
 * 存好的那一份（已是当前配置）连同这次导入的结局。成功相位直接带回它：配置列表与当前配置要等
 * 流水线收尾才重发，结论页若去读那两份，会先闪一下旧的当前配置。
 */
data class ImportedProfile(val profile: Profile, val outcome: ImportOutcome)

sealed interface ImportPhase {
    /** 稳定 token：golden 相位轨迹用。 */
    val token: String

    data object Verifying : ImportPhase {
        override val token: String get() = "verifying"
    }

    data object Stopping : ImportPhase {
        override val token: String get() = "stopping"
    }

    data class Downloading(val willApply: Boolean) : ImportPhase {
        override val token: String get() = "downloading(apply=$willApply)"
    }

    data class Success(val info: TrafficInfo, val imported: ImportedProfile) : ImportPhase {
        override val token: String get() = "success"
    }

    data object Applying : ImportPhase {
        override val token: String get() = "applying"
    }

    data class Applied(val imported: ImportedProfile) : ImportPhase {
        override val token: String get() = "applied"
    }

    data class Failed(val error: ImportError) : ImportPhase {
        override val token: String get() = "failed(${error.token})"
    }
}

class ImportFlow(
    private val fetcher: ConfigFetcher,
    private val tunnel: TunnelControl,
    private val store: ProfileStore,
    private val trusted: Set<String>,
    private val userAgent: () -> String,
    private val now: () -> Long,
    private val newId: () -> String,
) {
    suspend fun run(payload: ImportPayload, onPhase: (ImportPhase) -> Unit): ImportPhase {
        // 仅 requestedApply 验证域名；未命中不报错，降级为手动导入继续（willApply 只减不增）。
        var willApply = false
        if (payload.requestedApply) {
            onPhase(ImportPhase.Verifying)
            willApply = DomainVerify.verify(UrlInfo.hostname(payload.url), trusted)
        }
        // willApply 才停隧道；stop 对上不抛，超时/异常结局均继续下载。
        if (willApply) {
            onPhase(ImportPhase.Stopping)
            tunnel.stop()
        }
        onPhase(ImportPhase.Downloading(willApply))
        val reply = try {
            fetcher.fetch(payload.url, userAgent())
        } catch (cancelled: CancellationException) {
            throw cancelled // 调用方取消原样上抛。
        } catch (failed: Exception) {
            return finish(ImportPhase.Failed(ImportError.DownloadNetwork(describe(failed))), onPhase)
        }
        if (reply.status !in 200..299) {
            return finish(ImportPhase.Failed(ImportError.DownloadHttp(reply.status)), onPhase)
        }
        val verdict = ConfigCheck.validate(reply.body)
        if (verdict is ConfigVerdict.Invalid) {
            return finish(ImportPhase.Failed(ImportError.InvalidContent(verdict.reason)), onPhase)
        }
        val info = Userinfo.parse(reply.header(Userinfo.HEADER))
        val existing = store.getAll().firstOrNull { it.url == payload.url }
        val outcome = if (existing == null) ImportOutcome.ADDED else ImportOutcome.UPDATED
        val name = ProfileName.derive(reply.header("content-disposition"), existing?.name ?: "", payload.url)
        val importedAt = now()
        val stored = store.upsertByUrlAndActivate(
            Profile(
                id = newId(),
                name = name,
                url = payload.url,
                usedTraffic = info.upload + info.download,
                totalTraffic = info.total,
                expireTime = info.expire, // 单位 Unix 纪元秒，展示层换算。
                addedAt = importedAt,
                updatedAt = importedAt,
                website = ProfileWebsite.parse(reply.header(ProfileWebsite.HEADER)),
            ),
            content = reply.body, // 存原始响应体，改写全部延至启动期合并。
        )
        val imported = ImportedProfile(stored, outcome)
        if (!willApply) return finish(ImportPhase.Success(info, imported), onPhase)
        onPhase(ImportPhase.Applying)
        try {
            tunnel.start()
        } catch (cancelled: CancellationException) {
            throw cancelled // 已存储的 profile 保留。
        } catch (failed: Exception) {
            // 已存储的 profile 不回滚，保持断开态。
            return finish(ImportPhase.Failed(ImportError.StartFailed(describe(failed))), onPhase)
        }
        return finish(ImportPhase.Applied(imported), onPhase)
    }

    // 终态也依序对 UI 可见，经 onPhase 后作为返回值。
    private fun finish(terminal: ImportPhase, onPhase: (ImportPhase) -> Unit): ImportPhase {
        onPhase(terminal)
        return terminal
    }
}
