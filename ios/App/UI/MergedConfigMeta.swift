import Core

// 合并输出的展示派生（唯一实现）：配置查看页元信息（+N 出站 · DNS）
// 与设置页 DNS 行共用。输入必须是本仓合并器（单一实现）的产物——严格 JSON 已由
// 合并器保证；解析失败即不变量破坏 → 崩溃暴露，不做防御兜底。
struct MergedConfigMeta: Equatable {
    /// 注入的节点出站数：按合并器的组/功能型类型集（单一来源）取反计数。
    let injectedOutboundCount: Int

    /// 合并改写后的 system DNS 服务器；模板无 system 项时为 nil（改写是空操作）。
    let systemDns: String?

    static func parse(_ mergedText: String) -> MergedConfigMeta {
        guard case .jsonObject(let root)? = try? Json.parse(mergedText) else {
            preconditionFailure("merged config is not a JSON object — merge invariant broken")
        }
        return MergedConfigMeta(
            injectedOutboundCount: injectedOutboundCount(root),
            systemDns: systemDns(root)
        )
    }

    private static func injectedOutboundCount(_ root: JsonObject) -> Int {
        guard case .jsonArray(let outbounds)? = root.get("outbounds") else {
            preconditionFailure("merged config missing outbounds array — merge invariant broken")
        }
        return outbounds.items.filter { item in
            guard case .jsonObject(let outbound) = item,
                  case .jsonString(let type)? = outbound.get("type") else { return false }
            return !ConfigMerge.excludedOutboundTypes.contains(type)
        }.count
    }

    private static func systemDns(_ root: JsonObject) -> String? {
        guard case .jsonObject(let dns)? = root.get("dns"),
              case .jsonArray(let servers)? = dns.get("servers") else { return nil }
        // **首个 tag=system 的项即定值**（与 Userinfo「首个结构匹配即定值」同一惯用语，
        // 也与 Android 侧一致）：该项缺 `server` 时不继续往后找。模板只有一个 system 项，
        // 但两端镜像的取值语义不能靠「反正到不了」维持。
        for item in servers.items {
            guard case .jsonObject(let server) = item,
                  case .jsonString("system")? = server.get("tag") else { continue }
            guard case .jsonString(let address)? = server.get("server") else { return nil }
            return address
        }
        return nil
    }
}
