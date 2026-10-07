package cloud.oneoh.oneboxn.ui

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 到期时间展示（expire 为 Unix 纪元秒；≤0 = 无到期信息 → 占位符）。
// Home 用量摘要卡与导入成功用量卡共用。
internal fun expiryDateLabel(epochSeconds: Long): String =
    if (epochSeconds <= 0) {
        "—"
    } else {
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(epochSeconds * 1000))
    }

// 用量刻度：日期与小时都钉 Locale.US——同一纪元秒跟随环境 locale
// 会在伊朗显示波斯历，与另一端和存储语义全不对齐（`make check rule=locale` 守）。
internal fun usageDateLabel(epochSeconds: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(epochSeconds * 1000))

internal fun hourLabel(epochSeconds: Long): String =
    SimpleDateFormat("HH:mm", Locale.US).format(Date(epochSeconds * 1000))

// 配置详情的「上次更新」：本地时区的日期与分钟（纪元毫秒）。
internal fun updatedAtLabel(epochMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(epochMillis))
