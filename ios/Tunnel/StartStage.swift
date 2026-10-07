import Core
import Foundation
import os.log

private let logger = Logger(subsystem: "cloud.oneoh.networktools.tunnel", category: "StartStage")

// 启动阶段轨迹（:tun 侧）——诊断阶梯第 2 级的写端。
//
// 存在的理由：正常失败路径会写 start_error.txt 携带真因，但扩展被系统杀死或崩溃时走不到那步，
// UI 只能看到空诊断。留下最后到达的阶段，使「没有错误」本身可定位到具体步骤。
// 启动成功即清除——残留标记就代表上次启动没走完。
//
// 三个入口的失败一律落 `logger.error`：这一级只此一条通道，任一端静默即整级消失，而它恰恰是
// 「扩展死在哪一步」的唯一答案。不崩——崩了会把「扩展死于启动途中」换成「扩展死于写标记」。
enum StartStage {
    static func mark(_ stage: String) {
        let url = AppGroupPaths.startStageURL()
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try stage.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            logger.error("start stage mark failed: \(describe(error), privacy: .public)")
        }
    }

    static func clear() {
        do {
            try FileManager.default.removeItem(at: AppGroupPaths.startStageURL())
        } catch CocoaError.fileNoSuchFile {
            // 标记本就不在（本次启动一路没写过）：这是正常形态，不是失败。
        } catch {
            // 清不掉的残留会在下一次失败时冒充本次的终止阶段——诊断从此指向上一次的步骤。
            logger.error("start stage clear failed: \(describe(error), privacy: .public)")
        }
    }
}
