package cloud.oneoh.oneboxn.profile

import cloud.oneoh.oneboxn.core.RefreshRecordStore
import cloud.oneoh.oneboxn.core.RefreshRecordStorage
import java.io.File

// RefreshRecordStorage 的 Android 平台实现：读写 filesDir 下的单个文件（镜像 FileProfileStorage）。
class FileRefreshRecordStorage(filesDir: File) : RefreshRecordStorage {
    private val file = File(filesDir, RefreshRecordStore.FILE_NAME)

    override fun load(): ByteArray? = if (file.exists()) file.readBytes() else null

    override fun save(bytes: ByteArray) {
        file.writeBytes(bytes)
    }
}
