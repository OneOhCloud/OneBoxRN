// 宿主把系统路径变化翻成交给引擎的哪一条上报。
//
// 引擎不监听系统网络，这条上报是切网后代理自愈的唯一触发源；但 networkChanged 会关掉全部
// 活连接，同一张上行的属性抖动（地址刷新、计费属性变化）也触发它，正在下载的连接会被无故掐断。
// 故只有「路径可不可用」或「上行是哪张卡」变了才 reset，其余变化只让引擎重读快照。
public enum NetworkPathReport: Sendable, Equatable {
    /// 路径可用：引擎开探测闸门并重置网络，出站绑卡随之换到当前上行。
    case networkChanged
    /// 路径不可用：引擎只挡住周期性探测，恢复交给下一次 networkChanged。
    case networkLost
    /// 默认网络没换、快照变了：引擎只重读快照。
    case propertiesChanged
}

/// 物理上行的身份。网卡拔插重建后名字可能不变而 index 变了，旧连接仍挂在已消失的那张卡上，
/// 故名字与 index 任一变化都算换了上行。
public struct UplinkIdentity: Sendable, Equatable {
    public let name: String
    public let index: Int

    public init(name: String, index: Int) {
        self.name = name
        self.index = index
    }
}

/// 宿主对路径的一次观察。`Details` 是交给引擎的其余快照（接口清单、计费属性……）。
public struct NetworkPathObservation<Details: Equatable>: Equatable {
    /// 可用不等于有物理上行：「绑哪张卡」答不上来时，探测闸门仍要开着。
    public let isAvailable: Bool
    public let uplink: UplinkIdentity?
    public let details: Details

    public init(isAvailable: Bool, uplink: UplinkIdentity?, details: Details) {
        self.isAvailable = isAvailable
        self.uplink = uplink
        self.details = details
    }

    /// 相对上一帧该交给引擎的上报；nil = 没有变化，不打扰引擎。
    public func report(since previous: Self) -> NetworkPathReport? {
        if isAvailable != previous.isAvailable || uplink != previous.uplink {
            return currentReport
        }
        return details == previous.details ? nil : .propertiesChanged
    }

    /// 不看上一帧、只报当前状态：引擎运行态刚建立时，它此前收不到的变化由这一条补齐。
    public var currentReport: NetworkPathReport {
        isAvailable ? .networkChanged : .networkLost
    }
}
