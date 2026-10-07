package cloud.oneoh.oneboxn

import android.content.res.AssetManager
import cloud.oneoh.oneboxn.core.RoutingMode
import java.io.FileNotFoundException

// 模板资产读取：`make templates` 落位到 assets/templates/<token>.json，
// 路径字面量唯一定义处即此。资产缺失 = 装配缺件，即崩不兜底。
object TemplateAssets {
    fun load(assets: AssetManager, mode: RoutingMode): String =
        try {
            assets.open("$DIR/${mode.token}.json").bufferedReader().use { it.readText() }
        } catch (missing: FileNotFoundException) {
            error("template asset missing for mode ${mode.token}: run `make templates`")
        }

    private const val DIR = "templates"
}
