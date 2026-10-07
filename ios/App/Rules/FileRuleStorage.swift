import Foundation
import Core

// RuleStorage 的 iOS 平台实现：读写目录下的单个文件（App Group 容器，见 AppMain）。
// 平台 IO 壳，不属纯核心；镜像 FileProfileStorage 模式。
final class FileRuleStorage: RuleStorage {
    private let fileURL: URL

    init(directory: URL) {
        fileURL = directory.appendingPathComponent(RuleStore.fileName)
    }

    func load() -> Data? { StorageFile.load(from: fileURL) }

    func save(_ bytes: Data) { StorageFile.save(bytes, to: fileURL) }
}
