package cloud.oneoh.oneboxn

import cloud.oneoh.oneboxn.core.ConfigMerge
import cloud.oneoh.oneboxn.core.MergeError
import cloud.oneoh.oneboxn.core.MergeInput
import cloud.oneoh.oneboxn.core.RoutingMode
import cloud.oneoh.oneboxn.core.TunExclusionPolicy
import cloud.oneoh.oneboxn.core.Utf8Length
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

fun interface ConfigTemplateSource {
    fun load(mode: RoutingMode): String
}

data class ConfigCompileRequest(
    val mode: RoutingMode,
    val directDns: String,
)

/**
 * 一次编译的产出：引擎将收到的配置 + 记账归属。
 *
 * 两者同一次存储快照取出，故隧道进程拿到的 profileId 恒对应它实际启动的那份配置——
 * 合并是异步的，事后再读一次「当前激活」会在切换瞬间张冠李戴。
 */
data class CompiledStart(
    val config: String,
    val profileId: String,
)

data class ConfigCompilerDispatchers(
    val io: CoroutineDispatcher = Dispatchers.IO,
    val computation: CoroutineDispatcher = Dispatchers.Default,
)

/** 启动与配置查看共用的唯一编译出口：快照、模板 IO、纯合并各自位于明确调度边界。 */
class ConfigCompiler(
    private val dataRepository: AppDataRepository,
    private val templateSource: ConfigTemplateSource,
    private val dispatchers: ConfigCompilerDispatchers = ConfigCompilerDispatchers(),
) {
    private val templateMutex = Mutex()
    private val templates = mutableMapOf<RoutingMode, String>()

    suspend fun compile(request: ConfigCompileRequest): CompiledStart {
        val stored = dataRepository.configSnapshot()
        // 提前短路：上限与错误由 core ConfigMerge 单点持有（此处引同一常量），这里只是不让
        // 超大配置白白触发模板读取。合并入口那道检查才是正确性保证——两端都过它。
        if (Utf8Length.of(stored.importedConfig) > ConfigResourceLimits.MAX_IMPORTED_CONFIG_SIZE) {
            throw MergeError("imported config exceeds processing limit")
        }
        val template = template(request.mode)
        val input = MergeInput(
            importedConfig = stored.importedConfig,
            template = template,
            mode = request.mode,
            rules = stored.rules,
            logLevel = LOG_LEVEL,
            directDns = request.directDns,
            tunExcludeField = ConfigMerge.TUN_EXCLUDE_ANDROID,
            // 排除项是应用包名而不是网段，没有前缀长度可供分流。
            tunExclusionPolicy = TunExclusionPolicy.Union,
        )
        val compiled = withContext(dispatchers.computation) { ConfigMerge.merge(input) }
        return CompiledStart(config = compiled, profileId = stored.activeProfileId)
    }

    private suspend fun template(mode: RoutingMode): String = templateMutex.withLock {
        templates[mode] ?: withContext(dispatchers.io) {
            templateSource.load(mode)
        }.also { templates[mode] = it }
    }

    private companion object {
        const val LOG_LEVEL = "info"
    }
}
