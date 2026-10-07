import Network

// 宿主报给引擎的默认网络在 Apple 上就是引擎出站绑卡的来源：隧道扩展在沙盒里，引擎探测不到
// 路由，只能采信宿主。引擎只认物理类型（wifi / cellular / 有线）的默认网络——报成隧道类网卡，
// 引擎就不绑卡，出站回环进隧道自己刚建的 tun。
//
// 判据取接口类型、不取名字前缀：按名字猜归属靠不住，而 tun 的类型恒为 `.other`。
public enum PhysicalUplink {

    public enum Kind: Sendable, Equatable {
        case wifi
        case cellular
        case ethernet
    }

    /// 隧道类（`.other`，含本隧道自己的 utun）与回环不是物理上行，返回 nil。
    public static func kind(of type: NWInterface.InterfaceType) -> Kind? {
        switch type {
        case .wifi: .wifi
        case .cellular: .cellular
        case .wiredEthernet: .ethernet
        // 已知成员列全 + `@unknown default:`：`NWInterface.InterfaceType` 非 frozen，
        // 不认识的类型不能当物理网卡喂给引擎。
        case .loopback, .other: nil
        @unknown default: nil
        }
    }

    /// 路径的首选物理上行：系统给出的接口顺序就是偏好顺序，取其中第一张物理网卡。
    public static func preferred<Interface>(
        in interfaces: [Interface],
        type: (Interface) -> NWInterface.InterfaceType
    ) -> (interface: Interface, kind: Kind)? {
        for interface in interfaces {
            if let kind = kind(of: type(interface)) { return (interface, kind) }
        }
        return nil
    }
}
