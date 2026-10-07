package cloud.oneoh.oneboxn.update

import cloud.oneoh.oneboxn.core.UpdateCheckPacing
import kotlinx.coroutines.delay

/** 手动检查揭晓结果之前等满最短可见时长；[elapsedSinceTap] 读单调时钟，墙钟回拨会让等待变长或报错。 */
internal suspend fun awaitMinimumCheckVisibility(elapsedSinceTap: () -> Long) {
    delay(UpdateCheckPacing.revealDelayMillis(elapsedSinceTap()))
}
