import Foundation

/// 隧道 DNS 地址必须经隧道可达（纯逻辑；消费方是 Apple 隧道扩展把 TunSpec 落成系统路由的那一步）。
///
/// WHY：DNS 地址有两种方式落到隧道外，系统查询随之从物理网卡发出去，一条也回不来。
/// 其一，接管范围不是默认路由、又没有一条覆盖它；其二，某条排除项盖住了它——Apple 为每条排除项
/// 装一条经物理网关的路由，比默认路由更具体，最长前缀匹配归它。模板的排除项含整段私网
/// （172.16.0.0/12），TUN 自己的地址段与隧道 DNS 地址恰在其中，两种接管形状都会撞上。
/// 补一条指向 DNS 地址的主机路由，它比任何排除项都具体。
public enum TunnelDnsRoute {
    /// DNS 地址不在接管范围内、或落进某条排除项时，补一条指向它的主机路由。没有 DNS 地址、
    /// 或 DNS 地址不是这一族时原样返回。
    ///
    /// - Parameters:
    ///   - routes: 这一族的显式接管范围。
    ///   - excludes: 实际下发给系统的排除项（两族混在一起也可，不同族的不参与判定）。
    /// - Throws: `MalformedCidr`——DNS 地址、接管前缀或排除前缀不是合法字面量。
    public static func including(
        dnsServer: String,
        in routes: [TunPrefix],
        excluding excludes: [TunPrefix]
    ) throws -> [TunPrefix] {
        guard !dnsServer.isEmpty else { return routes }
        let host = try TunPrefix.parse(cidr: dnsServer)
        let target = try BinaryPrefix(host)
        let sameFamily = try routes.map(BinaryPrefix.init).filter { $0.octets.count == target.octets.count }
        guard !sameFamily.isEmpty else { return routes }
        let carried = sameFamily.contains { $0.covers(target) }
        let divertedByExclusion = try excludes.map(BinaryPrefix.init).contains { $0.covers(target) }
        guard !carried || divertedByExclusion else { return routes }
        return routes + [host]
    }
}
