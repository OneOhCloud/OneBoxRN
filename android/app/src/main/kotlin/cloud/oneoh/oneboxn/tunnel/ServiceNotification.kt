package cloud.oneoh.oneboxn.tunnel

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import cloud.oneoh.oneboxn.BuildConfig
import cloud.oneoh.oneboxn.MainActivity
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.core.NodeGroup
import cloud.oneoh.oneboxn.core.Traffic
import cloud.oneoh.oneboxn.ui.nodeDisplayName
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * 前台服务通知（Android 特有，iOS 的 NE 扩展无对端）。
 *
 * 线程分工：[render] 在引擎回调线程上，只做「算呈现值 + 过主闸 + 存进合并槽」；
 * `notify()` 是同步 binder 到 system_server，一律投递到本类自有的单线程通道执行——
 * 回调线程处在数据面上，与 [UsageRecorder] 同一条纪律。
 */
internal class ServiceNotification(private val context: Context) {

    private val manager by lazy { context.getSystemService(NotificationManager::class.java) }
    private val power by lazy { context.getSystemService(PowerManager::class.java) }
    private val deliveryWorker = Executors.newSingleThreadExecutor()

    /** 合并槽：投递在途时后到的帧覆盖它，不排队——否则 system_server 抖一下就堆出背压。 */
    private val pending = AtomicReference<NotificationContent?>()

    /** 代际令牌：卸载即 +1，在途投递据此作废，绝不在 stopForeground 之后把通知贴回来。 */
    @Volatile private var generation = 0

    /** 主闸的比较基准 = 最后一次**真正投递出去**的内容，不是最后一次算出来的。 */
    @Volatile private var posted: NotificationContent? = null

    /** 用户划掉之后本次会话不再重投。 */
    @Volatile private var dismissed = false

    // 每次构造都是一次 AMS binder，故缓存持有。
    private val contentIntent: PendingIntent by lazy {
        PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private val disconnectIntent: PendingIntent by lazy {
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(NotificationActionReceiver.ACTION_DISCONNECT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private val dismissIntent: PendingIntent by lazy {
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(TunnelSignals.ACTION_NOTIFICATION_DISMISSED).setPackage(context.packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    fun ensureChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_tunnel),
            NotificationManager.IMPORTANCE_LOW,
        )
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }

    /**
     * `startForeground` 用的那一次构建：**恒是回落形态**，不等首帧。
     *
     * `startForegroundService` 要求 10 秒内转前台，为「等第一帧数据」推迟即崩隧道。
     */
    fun build(): Notification = compose(NotificationContent.IDLE)

    /** 装载：新一代开始，主闸基准与划除标记归零（在 onStartCommand 调）。 */
    fun start() {
        generation += 1
        pending.set(null)
        posted = NotificationContent.IDLE
        dismissed = false
    }

    /**
     * 停止沿的第一步：立即收敛为回落形态，**不等** `stopForeground`。
     *
     * 那之后还有停引擎、扫尾、关描述符几步（可能几秒），期间通知不能还挂着最后一帧的数字——
     * `Traffic` 在隧道停止时停在最后一帧而非归零，不主动收敛就等于把「已经停了」画成「还在跑」。
     *
     * **这里不 cancel**：服务此刻仍在前台，而在前台态下 cancel 前台服务通知的行为跨版本不一致；
     * 移除交给随后的 `stopForeground(STOP_FOREGROUND_REMOVE)`，[stop] 只做兜底。
     */
    fun collapse() {
        generation += 1 // 作废在途的数据帧投递，免得它们排在收敛之后又把数字贴回来。
        pending.set(null)
        posted = null
        enqueue(NotificationContent.IDLE)
    }

    /**
     * 卸载：作废这一代，并在 `stopForeground` 之后显式 cancel 兜底。
     *
     * 必须在 `stopTunnel()` 与 `onDestroy()` **两处**都调：后者并不走 `stopForegroundCompat`，
     * 只卸一处会在「服务被系统直接销毁」那条路上留下还在投递的消费者。
     *
     * **不关投递线程**：同一个 Service 实例可能在销毁完成前又收到一次启动（快速连断），
     * 关掉之后那一次的投递会全被拒，通知从此不再更新。线程的归还在 [close]。
     */
    fun stop() {
        generation += 1
        pending.set(null)
        posted = null
        runCatching { manager.cancel(NOTIFICATION_ID) }
    }

    /** 服务销毁：卸载并归还投递线程。 */
    fun close() {
        stop()
        deliveryWorker.shutdown()
    }

    /** 用户划掉了通知：本次会话内不再重投。 */
    fun onDismissed() {
        dismissed = true
    }

    /**
     * 引擎回调线程（数据面）：算出呈现值、过主闸、进合并槽。**不在这里投递**。
     *
     * 次闸（屏幕是否交互）不在这里判——它要问系统，放在这儿等于为了省一次 binder 先做一次 binder。
     */
    fun render(traffic: Traffic?, groups: List<NodeGroup>) {
        enqueue(NotificationContent.of(traffic, groups))
    }

    private fun enqueue(content: NotificationContent) {
        if (dismissed) return
        if (content == posted) return // 主闸：渲染出来逐字相同就不投递。
        val token = generation
        if (pending.getAndSet(content) != null) return // 已有在途投递，它会取走最新的这一份。
        // 投递被拒只落诊断，绝不回抛数据面。
        runCatching {
            deliveryWorker.execute {
                val next = pending.getAndSet(null) ?: return@execute
                if (token != generation) return@execute // 这一代已经卸了，不许贴回来。
                deliver(next)
            }
        }.onFailure { Log.w(TAG, "notification delivery rejected", it) }
    }

    private fun deliver(content: NotificationContent) {
        if (power?.isInteractive == false) return // 次闸：熄屏期间没人看，不投。
        runCatching { manager.notify(NOTIFICATION_ID, compose(content)) }
            .onSuccess {
                posted = content
                // 两道闸是否真的生效，只有数投递次数才看得出来（dumpsys 看不出更新频率）——
                // 故 debug 构建每次真投递落一行固定 token，用它计数。
                if (BuildConfig.DEBUG) Log.d(TAG, NOTIFY_PROBE)
            }
            .onFailure { Log.w(TAG, "notification post failed", it) }
    }

    private fun compose(content: NotificationContent): Notification {
        val title = content.nodeTag
            ?.let { nodeDisplayName(it, content.autoResolved, context.getString(R.string.nodes_auto)) }
            ?: context.getString(R.string.notification_tunnel_title)
        // 小图标是 logo 的单色标记（仪表盘剪影）：系统只取 alpha 形状，彩色 logo 在这里会成一块实心方砖。
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_brand_mark)
            .setContentTitle(title)
            .setContentIntent(contentIntent)
            .setDeleteIntent(dismissIntent)
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            // 节点名可能含地区或线路标识，锁屏上只给回落标题那一份。
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_brand_mark)
                    .setContentTitle(context.getString(R.string.notification_tunnel_title))
                    .setShowWhen(false)
                    .build(),
            )
            .addAction(0, context.getString(R.string.notification_action_disconnect), disconnectIntent)

        content.figures?.let { figures ->
            val rateLine = rateLine(figures.downRate, figures.upRate)
            builder.setContentText(rateLine)
            builder.setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    rateLine + "\n" + context.getString(
                        R.string.notification_total,
                        rateLine(figures.downTotal, figures.upTotal),
                    ),
                ),
            )
        }
        return builder.build()
    }

    /**
     * 左为下行、右为上行，与首页速率行同序。
     *
     * 方向用既有 `home_download` / `home_upload` 的完整句式而非箭头：通知正文就是读屏念出来的
     * 内容，没有第二个无障碍标签通道。
     */
    private fun rateLine(down: String, up: String): String =
        context.getString(R.string.home_download, down) + "  " + context.getString(R.string.home_upload, up)

    internal companion object {
        const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "tunnel"
        private const val TAG = "ServiceNotification"

        /** 投递计数探针（仅 debug）：`adb logcat -d | grep -c NOTIFY_POSTED`。 */
        private const val NOTIFY_PROBE = "NOTIFY_POSTED"
    }
}
