package cloud.oneoh.oneboxn.rules

import cloud.oneoh.oneboxn.core.RuleStore
import cloud.oneoh.oneboxn.core.RuleStorage
import java.io.File

// RuleStorage 的 Android 平台实现：读写 filesDir 下的单个文件（镜像 profile/FileProfileStorage）。
// 编码/解码全部在 core RuleStore（壳只搬字节）。
class FileRuleStorage(filesDir: File) : RuleStorage {
    private val file = File(filesDir, RuleStore.FILE_NAME)

    override fun load(): ByteArray? = if (file.exists()) file.readBytes() else null

    override fun save(bytes: ByteArray) {
        file.writeBytes(bytes)
    }
}
