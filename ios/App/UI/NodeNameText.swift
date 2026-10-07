import Core

// 节点显示名：自动组是模板固定 tag，向用户显示本地化名而非裸 tag；
// 其余 tag 由服务端下发，原样显示不翻译（Android 对等物 NodeNameText.kt）。
func nodeNameText(tag: String, autoResolved: String) -> String {
    guard NodeSelection.isAutoTag(tag) else { return tag }
    return NodeSelection.autoLabel(localizedName: tr("nodes_auto"), autoResolved: autoResolved)
}

/// 节点名在屏上的两段。自动组拆成「实际出口」与「自动选择」两行：
/// 连成一行时括号把名字撑长，一截断先丢的就是括号里的实际出口。
/// 首页节点行与节点弹层行共用这一次拆分，两处只是上下次序不同。
struct NodeNameLines: Equatable {
    /// 手选节点名，或自动组此刻的实际出口；自动组尚未解析出出口时就是「自动选择」本身。
    let name: String
    /// 自动组且已解析出出口时才有：「自动选择」这一小行。
    let autoCaption: String?

    static func of(tag: String, autoResolved: String) -> NodeNameLines {
        guard NodeSelection.isAutoTag(tag), !autoResolved.isEmpty else {
            return NodeNameLines(name: nodeNameText(tag: tag, autoResolved: autoResolved), autoCaption: nil)
        }
        return NodeNameLines(name: autoResolved, autoCaption: tr("nodes_auto"))
    }

    /// 读屏读完整名称：先说是自动选择，再说出口。
    var spoken: [String] {
        [autoCaption, name].compactMap { $0 }
    }
}
