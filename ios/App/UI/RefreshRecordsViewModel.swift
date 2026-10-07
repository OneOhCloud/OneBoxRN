import Foundation
import Observation
import Core

// 更新记录页状态：时间线快照 + 当前打开的详情。
// 记录只在抓取终点追加，页面在进入时取一次快照即可——不为一个诊断页挂常驻观察。
// 镜像 Android ui/RefreshRecordsViewModel.kt。
@MainActor
@Observable
final class RefreshRecordsViewModel {
    /// 时间线，最新在前；行与详情共用同一个带身份的载荷。
    private(set) var timeline: [RefreshRecordDetail]

    /// 打开详情的那条记录；nil = 未打开（详情是弹层，不是路由）。
    var detail: RefreshRecordDetail?

    init(actions: AppActions) {
        timeline = actions.refreshRecordTimeline().map(RefreshRecordDetail.init)
    }
}

/// 列表与 sheet(item:) 都要身份；记录本身没有 id，用发生时刻 + profile 合成一个
/// （与 Android 侧 items(key =) 同构——只用时刻会让同一毫秒内的两条记录撞 id）。
struct RefreshRecordDetail: Identifiable {
    let record: RefreshRecord

    var id: String { "\(record.occurredAtMillis)-\(record.profileId)" }
}
