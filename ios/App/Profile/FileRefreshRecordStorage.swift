import Foundation
import Core

// RefreshRecordStorage 的 iOS 平台实现：读写目录下的单个文件（镜像 FileProfileStorage）。
// 平台 IO 壳，不属纯核心。
final class FileRefreshRecordStorage: RefreshRecordStorage {
    private let fileURL: URL

    init(directory: URL) {
        fileURL = directory.appendingPathComponent(RefreshRecordStore.fileName)
    }

    func load() -> Data? { StorageFile.load(from: fileURL) }

    func save(_ bytes: Data) { StorageFile.save(bytes, to: fileURL) }
}
