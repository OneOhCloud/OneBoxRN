package cloud.oneoh.oneboxn.benchmark

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import java.util.regex.Pattern

internal const val TARGET_PACKAGE_NAME = "cloud.oneoh.networktools"

private const val UI_WAIT_TIMEOUT_MILLISECONDS = 5_000L

internal fun MacrobenchmarkScope.startApplicationAndWait() {
    startActivityAndWait()
    check(device.wait(Until.hasObject(By.pkg(TARGET_PACKAGE_NAME)), UI_WAIT_TIMEOUT_MILLISECONDS)) {
        "OneBoxM did not expose a window within $UI_WAIT_TIMEOUT_MILLISECONDS ms"
    }
}

internal fun MacrobenchmarkScope.navigatePrimaryTabs() {
    clickNavigationTab(englishLabel = "Profiles", chineseLabel = "配置")
    clickNavigationTab(englishLabel = "Settings", chineseLabel = "设置")
    clickNavigationTab(englishLabel = "Home", chineseLabel = "首页")
}

private fun MacrobenchmarkScope.clickNavigationTab(englishLabel: String, chineseLabel: String) {
    val exactLocalizedLabel = Pattern.compile("^(?:${Pattern.quote(englishLabel)}|${Pattern.quote(chineseLabel)})$")
    val tab = requireNotNull(
        device.wait(Until.findObject(By.text(exactLocalizedLabel)), UI_WAIT_TIMEOUT_MILLISECONDS),
    ) {
        "Navigation tab '$englishLabel' was not found within $UI_WAIT_TIMEOUT_MILLISECONDS ms"
    }
    tab.click()
    device.waitForIdle(UI_WAIT_TIMEOUT_MILLISECONDS)
}
