package cloud.oneoh.oneboxn.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import cloud.oneoh.oneboxn.App
import cloud.oneoh.oneboxn.AppActions
import cloud.oneoh.oneboxn.core.ConfigChange
import cloud.oneoh.oneboxn.core.RoutingMode
import cloud.oneoh.oneboxn.core.configChangeDisposition
import cloud.oneoh.oneboxn.core.sessionPhase
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.core.ImportPhase
import cloud.oneoh.oneboxn.net.GoogleResult
import cloud.oneoh.oneboxn.net.testGoogleReachability
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

// 开发期命令 harness（仅 debug sourceSet，绝不进 release）。
// 驱动：adb shell am broadcast -n cloud.oneoh.oneboxn/cloud.oneoh.oneboxn.debug.HarnessReceiver
//       -a cloud.oneoh.oneboxn.HARNESS --es op <命令> [--es <键> <值>]；命令清单见 op=help，
//       每个命令的结局只经 logcat（标签 Harness）打一行 [[HARNESS]] 回报。
// 除 test-google 外每个 op 都复用 App.actions（与 UI 按钮同一底层动作），此处不重造动作逻辑。
// test-google 是唯一例外：它的探针只服务本 harness，放 main 会让发布包带着永不调用的
// 外部网络代码，故与本文件同在 debug 源集，直接调用而不经 AppActions 转发。
class HarnessReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val actions = (context.applicationContext as App).actions
        val op = intent.getStringExtra("op") ?: "help"
        // **本次广播就地结束，不用 `goAsync()` 撑着**：
        // Android 对同一进程的广播是串行投递的，`goAsync()` 会把本条广播一直持有到 op 跑完，
        // 期间 `:tun` 发回的任何广播都排在它后面。而配置变更类 op 恰恰要等 `:tun` 的重载结局
        // 广播——于是 op 等广播、广播等 op，死锁到 20 秒超时才解开，还会把一次**成功的**重载
        // 误判成失败并顺手把隧道拆掉。
        //
        // 代价是失去接收器那点进程存活加权；harness 的前提本就是 app 正在跑，
        // 而每个 op 的结局本来就只经 logcat 回报、不走广播返回值，故无损。
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        scope.launch {
            try {
                dispatch(actions, op, intent)
            } catch (error: Exception) {
                log("op=$op result=error detail=${error.message ?: error.javaClass.simpleName}")
            } finally {
                scope.cancel()
            }
        }
    }

    private suspend fun dispatch(actions: AppActions, op: String, intent: Intent) {
        when (op) {
            "import" -> {
                val url = intent.getStringExtra("url")?.takeIf { it.isNotBlank() } ?: actions.debugConfigUrl
                // 与 UI 同一条流水线（core ImportFlow，存原始体）；outbounds/bytes 只是落库后的观测。
                when (val terminal = actions.importProfile(ImportPayload(url = url, requestedApply = false)) {}) {
                    is ImportPhase.Success -> {
                        val stored = actions.activeProfile.value
                            ?: error("import succeeded without active profile")
                        val content = actions.activeConfigContent.value
                        val outbounds = JSONObject(content).optJSONArray("outbounds")?.length() ?: 0
                        log("op=import profile=${stored.name} outbounds=$outbounds bytes=${content.length}")
                    }
                    is ImportPhase.Failed -> log("op=import result=error detail=${terminal.error.token}")
                    else -> error("unexpected import terminal: ${terminal.token}")
                }
            }

            "connect" -> {
                log("op=connect state=connecting")
                actions.connect()
                val up = withTimeoutOrNull(CONNECT_TIMEOUT_MS) { actions.connected.first { it } } != null
                log("op=connect state=${if (up) "connected" else "pending"}")
            }

            "disconnect" -> {
                log("op=disconnect state=disconnecting")
                actions.disconnect()
                val down = withTimeoutOrNull(CONNECT_TIMEOUT_MS) { actions.connected.first { !it } } != null
                log("op=disconnect state=${if (down) "disconnected" else "pending"}")
            }

            "test-google" -> {
                val start = System.currentTimeMillis()
                val result = testGoogleReachability()
                val ms = System.currentTimeMillis() - start
                when (result) {
                    is GoogleResult.Http -> log("op=test-google status=${result.code} ms=$ms")
                    GoogleResult.Timeout -> log("op=test-google result=timeout ms=$ms")
                    is GoogleResult.Error -> log("op=test-google result=error ms=$ms detail=${result.message}")
                }
            }

            "select-node" -> {
                val tag = intent.getStringExtra("tag")
                if (tag.isNullOrBlank()) {
                    log("op=select-node result=error detail=missing tag")
                } else {
                    actions.selectNode(tag)
                    log("op=select-node tag=$tag")
                }
            }

            // 热重载验证的首选 op：路由模式是最短的一条配置变更链，改完即可对着通知栏 / ip addr
            // 核对系统 VPN 会话没断。token 取 RoutingMode.token 权威字面量，不另设 alias。
            "set-mode" -> {
                val mode = intent.getStringExtra("mode")
                if (mode.isNullOrBlank()) {
                    log("op=set-mode result=error detail=missing mode")
                } else {
                    // 未知 token 经 RoutingMode.fromToken 抛出，由 onReceive 外层 catch 落 result=error（fail-loud）。
                    val phase = sessionPhase(
                        osConnected = actions.connected.value,
                        engineStatus = actions.status.value,
                    )
                    val disposition = configChangeDisposition(phase, ConfigChange.ENGINE_CONFIG)
                    actions.setRoutingMode(RoutingMode.fromToken(mode))
                    log("op=set-mode mode=$mode disposition=${disposition.name.lowercase()} result=ok")
                }
            }

            // 跑一轮后台自动更新会跑的那件事（全部 profile 串行逐个），
            // 免得为验一条周期任务去等 1800 秒。记录随之落地，可在开发者页核对。
            "refresh" -> {
                actions.refreshAllProfiles()
                val records = actions.refreshRecordTimeline()
                val latest = records.firstOrNull()
                log(
                    "op=refresh profiles=${actions.profiles.value.size} records=${records.size} " +
                        "latest=${latest?.outcome?.name?.lowercase() ?: "none"} route=${latest?.route?.name?.lowercase() ?: "none"}",
                )
            }

            "status" -> log(
                "op=status connected=${actions.connected.value} " +
                    "engine=${actions.status.value.name.lowercase()}",
            )

            // UI 此刻拿在手里的分组读数（与节点面板同一份 StateFlow），逐节点一行：
            // 一行装下整组会撞上 logcat 的单行长度上限，被截断的 JSON 没法解析。
            "groups" -> {
                val groups = actions.groups.value
                val generation = actions.groupsGeneration.value
                log(
                    "op=groups generation=$generation testing=${actions.latencyTesting.value} " +
                        "groups=${groups.size} nodes=${groups.sumOf { it.nodes.size }}",
                )
                for (group in groups) {
                    for (node in group.nodes) {
                        val reading = JSONObject()
                            .put("group", group.tag)
                            .put("now", group.now)
                            .put("tag", node.tag)
                            .put("delayMs", node.delayMs)
                        log("op=groups-node generation=$generation reading=$reading")
                    }
                }
                log("op=groups-end generation=$generation")
            }

            "help" -> log("op=help ops=${OPS.joinToString(",")}")

            else -> log("op=$op result=error detail=unknown op, ops=${OPS.joinToString(",")}")
        }
    }

    private fun log(message: String) {
        Log.i(TAG, "[[HARNESS]] $message")
    }

    private companion object {
        const val TAG = "Harness"
        const val CONNECT_TIMEOUT_MS = 9_000L
        val OPS = listOf(
            "import", "connect", "disconnect", "test-google", "select-node",
            "set-mode", "refresh", "status", "groups", "help",
        )
    }
}
