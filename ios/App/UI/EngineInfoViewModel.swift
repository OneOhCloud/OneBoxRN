import Foundation
import Core

// 关于引擎页状态：自陈在进程内恒定，
// 进页面取一次即可——不为一个只读诊断页挂常驻观察。镜像 Android ui/EngineInfoViewModel.kt。
@MainActor
struct EngineInfoViewModel {
    let info: EngineInfo

    init() {
        info = OneBoxMApp.engineInfo
    }
}
