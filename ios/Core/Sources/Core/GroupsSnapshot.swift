import Foundation

// groups 快照的跨进程编码：组列表长度不定，datagram 装不下也不该分片，故走 App Group
// 原子文件，观察通道只发 invalidation 代号通知 UI 重读。
//
// 用独立 DTO 而非给 NodeGroup/Node 加 Codable：契约类型是 UI 消费面，不该被存储格式绑死；
// 字段名固定在此处，跨进程双方只认这一份。
public enum GroupsSnapshotCodec {
    /// 编码不出来即崩溃暴露：DTO 是本仓自己定义的（全是 String / Int64 / Bool），编码失败必是
    /// 本仓 bug。折成空 `Data()` 会写出一份 0 字节快照，读侧 decode 不出来就丢弃等下一次——
    /// 于是分组列表从此永久空白而无人知情。
    public static func encode(_ groups: [NodeGroup]) -> Data {
        let dto = groups.map(GroupDto.init)
        do {
            return try JSONEncoder().encode(dto)
        } catch {
            preconditionFailure("groups snapshot not encodable: \(describe(error))")
        }
    }

    /// 坏/半写快照返回 nil：写侧是原子替换，读到不完整内容说明与写入竞态，丢弃等下一次
    /// invalidation 即可，不该抛错中断观察。
    public static func decode(_ data: Data) -> [NodeGroup]? {
        guard let dto = try? JSONDecoder().decode([GroupDto].self, from: data) else { return nil }
        return dto.map { $0.toNodeGroup() }
    }
}

private struct GroupDto: Codable {
    let tag: String
    let nodes: [NodeDto]
    let now: String

    init(_ group: NodeGroup) {
        tag = group.tag
        nodes = group.nodes.map(NodeDto.init)
        now = group.now
    }

    func toNodeGroup() -> NodeGroup {
        NodeGroup(tag: tag, nodes: nodes.map { $0.toNode() }, now: now)
    }
}

private struct NodeDto: Codable {
    let tag: String
    let delayMs: Int

    init(_ node: Node) {
        tag = node.tag
        delayMs = node.delayMs
    }

    func toNode() -> Node {
        Node(tag: tag, delayMs: delayMs)
    }
}
