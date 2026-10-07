import Foundation
import Core

// ProfileStorage 的 iOS 平台实现：读写目录下的单个文件（App Group 容器，见 AppMain）。
// 平台 IO 壳，不属纯核心。
final class FileProfileStorage: ProfileStorage {
    private let fileURL: URL

    init(directory: URL) {
        fileURL = directory.appendingPathComponent(ProfileStore.fileName)
    }

    func load() -> Data? { StorageFile.load(from: fileURL) }

    func save(_ bytes: Data) { StorageFile.save(bytes, to: fileURL) }
}
