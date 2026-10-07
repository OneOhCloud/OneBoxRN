package cloud.oneoh.oneboxn.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.core.MergeError
import cloud.oneoh.oneboxn.core.Region
import cloud.oneoh.oneboxn.core.RoutingMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 设置页真实状态（镜像 iOS App/UI/SettingsViewModel.swift）：只读状态汇总——
// 运行状态随 TunnelController.connected；DNS 行取合并输出 system 项；
// UA/版本串/外链 URL 经装配注入。零持久化写入：UA 复制只写系统剪贴板，build 号切换
// 为会话内存态。
class SettingsViewModel(
    private val actions: AppActions,
    private val versionName: String,
    /** 引擎版本（构建期注入的唯一来源），版本页脚与关于弹层共用。 */
    val engineVersion: String,
    val buildNumber: String,
    /** 唯一 UA 构造文件产出（与导入下载同源同值）。 */
    val userAgent: String,
    val websiteUrl: String,
    val privacyUrl: String,
    /** 关于弹层「系统信息」卡的操作系统行；由装配注入，本层不碰 android.os.Build。 */
    val operatingSystem: String,
    /** 连点窗口的时钟；单调时钟而非墙钟——改系统时间不该影响一个手势。 */
    private val monotonicNanos: () -> Long = System::nanoTime,
) : ViewModel() {
    init {
        // 装配缺件：外链 URL 构建期注入缺失即崩——不产出缺链接的运行态（仓根 .env 补 website=/privacy=）。
        require(websiteUrl.isNotEmpty()) { "website url missing: add website= to repo-root .env" }
        require(privacyUrl.isNotEmpty()) { "privacy url missing: add privacy= to repo-root .env" }
    }

    var connected by mutableStateOf(actions.connected.value)
        private set

    // 恒显合并输出 system 项（合并单一实现）；直连值随启动前探测且连接期间不变——
    // 已连接显示值即启动配置值。无激活 profile / 导入原文不可合并
    //（MergeError 领域错误）→ null（视图给占位）。
    var dnsServer by mutableStateOf<String?>(null)
        private set

    /** UA 复制反馈（写入无可检测失败后置位，短暂显示后回落）；写剪贴板在视图层。 */
    var uaCopied by mutableStateOf(false)
        private set

    var showBuildNumber by mutableStateOf(false)
        private set

    /** 当前区域（快照读，切换时乐观本地更新；持久化唯一读取在 RegionStore）。 */
    var region by mutableStateOf(actions.region())
        private set

    /** 当前路由模式（持久化唯一读写处在 RoutingModeStore）。 */
    var routingMode by mutableStateOf(actions.routingMode())
        private set

    /** `v<app 版本>-<引擎版本>`。 */
    val versionLabel: String
        get() = "v$versionName-$engineVersion"

    private var copyRevert: Job? = null

    init {
        viewModelScope.launch { actions.connected.collect { connected = it } }
        // 导入/激活/刷新/删除均经 activeProfile 快照重发（AppActions.publishProfiles），DNS 随之重算。
        viewModelScope.launch { actions.activeProfile.collect { dnsServer = computeDns() } }
        // 启动前探测落地后 DNS 行随之刷新（取值仍走合并输出单点）。
        viewModelScope.launch { actions.directDns.collect { dnsServer = computeDns() } }
    }

    private suspend fun computeDns(): String? = withContext(Dispatchers.Default) {
        try {
            MergedConfigMeta.parse(actions.mergedConfig()).systemDns
        } catch (rejected: MergeError) {
            // UI 边界类型化：无激活/坏导入 → 占位展示；模板类崩溃不捕获。
            null
        }
    }

    fun markUaCopied() {
        uaCopied = true
        copyRevert?.cancel()
        copyRevert = viewModelScope.launch {
            delay(COPY_FEEDBACK_MS)
            uaCopied = false
        }
    }

    /** 长按切换 build 号显示（仅会话内存态）。 */
    fun toggleBuildNumber() {
        showBuildNumber = !showBuildNumber
    }

    // 版本页脚 800ms 滚动窗口内连点 3 次进开发者页。会话内存态，不持久化。
    private var versionTaps = 0
    private var lastTapNanos = 0L

    /**
     * 记一次点按；满 3 下即返回 true（调用方据此推入）。
     *
     * 窗口是**滚动**的：每次点按都重置计时，超窗即从 1 重新起算——不是「首次点按起 800ms 内点满」，
     * 那种写法会让第 3 下卡在窗口边界上失败，而用户感觉自己点得很快。
     */
    fun tapVersion(): Boolean {
        val now = monotonicNanos()
        versionTaps = if (now - lastTapNanos <= TAP_WINDOW_NANOS) versionTaps + 1 else 1
        lastTapNanos = now
        if (versionTaps < DEV_UNLOCK_TAPS) return false
        versionTaps = 0
        return true
    }

    /** 区域切换——只持久化（纯占位设置，无重启、无合并变化），故不需协程。 */
    fun selectRegion(value: Region) {
        region = value
        actions.setRegion(value)
    }

    /** 切换 = 立即持久化 + applyConfigurationChange。 */
    fun selectRoutingMode(value: RoutingMode) {
        if (value == routingMode) return
        routingMode = value
        viewModelScope.launch { actions.setRoutingMode(value) }
    }

    private companion object {
        const val DEV_UNLOCK_TAPS = 3
        const val TAP_WINDOW_NANOS = 800_000_000L
    }
}
