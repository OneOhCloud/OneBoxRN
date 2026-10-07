package cloud.oneoh.oneboxn.profile

import cloud.oneoh.oneboxn.core.ProfileStore
import cloud.oneoh.oneboxn.core.ProfileStorage
import java.io.File

// ProfileStorage 的 Android 平台实现：读写 filesDir 下的单个文件。
class FileProfileStorage(filesDir: File) : ProfileStorage {
    private val file = File(filesDir, ProfileStore.FILE_NAME)

    override fun load(): ByteArray? = if (file.exists()) file.readBytes() else null

    override fun save(bytes: ByteArray) {
        file.writeBytes(bytes)
    }
}
