import Foundation
import Network

// CIDR 文本 → 分族前缀的解析（中立纯逻辑，宿主 swift test 可锁，绑定层映射共用）。
public extension TunPrefix {
    // 坏 CIDR 在装配期即拒（fail-loud）：地址须合法 IP 字面量、前缀须落地址族区间
    // （v4:0-32/v6:0-128），不静默夹取——否则错误路由语义被推迟到平台 TUN builder 才暴露。
    static func parse(cidr: String) throws -> TunPrefix {
        let isV6 = isInet6(cidr: cidr)
        let maxPrefix: Int32 = isV6 ? 128 : 32
        guard let slash = cidr.firstIndex(of: "/") else {
            try validateIpLiteral(cidr, isV6: isV6, raw: cidr)
            return TunPrefix(address: cidr, prefix: maxPrefix)
        }
        let address = String(cidr[..<slash])
        try validateIpLiteral(address, isV6: isV6, raw: cidr)
        guard let prefix = Int32(cidr[cidr.index(after: slash)...]), prefix >= 0, prefix <= maxPrefix else {
            throw MalformedCidr(raw: cidr)
        }
        return TunPrefix(address: address, prefix: prefix)
    }

    // 地址族判定：地址部分（'/' 前）含 ':' 即 IPv6。
    static func isInet6(cidr: String) -> Bool {
        let address = cidr.split(separator: "/", maxSplits: 1).first.map(String.init) ?? cidr
        return address.contains(":")
    }

    /// 地址的二进制形态（v4 四字节 / v6 十六字节）。
    /// 地址字面量非法即抛，与 parse 同一 fail-loud 姿态，不静默返回零地址。
    func octets() throws -> [UInt8] {
        if address.contains(":") {
            guard let parsed = IPv6Address(address) else { throw MalformedCidr(raw: address) }
            return Array(parsed.rawValue)
        }
        guard let parsed = IPv4Address(address) else { throw MalformedCidr(raw: address) }
        return Array(parsed.rawValue)
    }

    private static func validateIpLiteral(_ address: String, isV6: Bool, raw: String) throws {
        let valid = isV6 ? (IPv6Address(address) != nil) : (IPv4Address(address) != nil)
        guard valid else { throw MalformedCidr(raw: raw) }
    }
}

public struct MalformedCidr: LocalizedError, CustomStringConvertible {
    public let raw: String
    public init(raw: String) { self.raw = raw }
    public var description: String { "malformed CIDR \"\(raw)\"" }
    // 跨 uniffi 桥后仅剩 localizedDescription，errorDescription 保住原始 CIDR 文本。
    public var errorDescription: String? { description }
}

/// 前缀的二进制形态：覆盖判定在字节上做，不反复解析地址文本。
struct BinaryPrefix {
    let octets: [UInt8]
    let length: Int

    init(_ prefix: TunPrefix) throws {
        octets = try prefix.octets()
        length = Int(prefix.prefix)
    }

    /// 本前缀是否覆盖 other（含相等）：同地址族、本前缀不更长、且 other 落在本网段内。
    func covers(_ other: BinaryPrefix) -> Bool {
        guard length <= other.length, octets.count == other.octets.count else { return false }
        var remaining = length
        var index = 0
        while remaining >= 8 {
            guard octets[index] == other.octets[index] else { return false }
            remaining -= 8
            index += 1
        }
        guard remaining > 0 else { return true }
        let mask = UInt8(truncatingIfNeeded: 0xff << (8 - remaining))
        return (octets[index] & mask) == (other.octets[index] & mask)
    }
}
