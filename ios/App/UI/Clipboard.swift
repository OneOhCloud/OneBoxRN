import UIKit

// 剪贴板**写入**的唯一出处。
enum Clipboard {
    /// 不读回校验：iOS 16+ 读剪贴板会弹粘贴授权，每复制一次弹一次的代价大于它能发现的故障。
    static func write(_ text: String) {
        UIPasteboard.general.string = text
    }
}
