package cloud.oneoh.oneboxn.ui

import androidx.lifecycle.ViewModel
import cloud.oneoh.oneboxn.core.EngineInfo

// 关于引擎页状态：自陈在进程内恒定（Android 是构建期烘焙常量），
// 进页面取一次即可——不为一个只读诊断页挂常驻观察。镜像 iOS App/UI/EngineInfoViewModel.swift。
class EngineInfoViewModel(val info: EngineInfo) : ViewModel()
