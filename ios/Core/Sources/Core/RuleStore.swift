import Foundation

// 自定义分流规则的纯逻辑存储：规范序维护 + 幂等增删改 + 序列化，经 RuleStorage 端口持久化。
// 序列化循 ProfileStore 的 ProfileCodec 模式：v1 版本头 + tab/换行分隔 + 同一转义表。
// 与 Android core/RuleStore.kt 逐字对应；golden/rule-store.json 是行为裁判。

public final class RuleStore {
    /// 落盘文件名。**放在这里而不是让每个消费方各写一份字面量**：
    /// **任一处笔误都不会有人报错**，只会让那一处安静地读到一个空文件。
    /// 住在共享模块里的名字无一例外被引用；住在模块外的无一例外被抄。
    public static let fileName = "rules.store"


    private let storage: RuleStorage
    private var rules: [Rule] = []

    public init(storage: RuleStorage) {
        self.storage = storage
        if let bytes = storage.load() {
            rules = RuleCodec.decode(String(decoding: bytes, as: UTF8.self))
        }
    }

    /// 规范序：action 声明序 → kind 声明序 → value Unicode 标量字典序；展示与注入共用此序列。
    public func getAll() -> [Rule] { rules }

    /// 批量加入；与既有三元组重复的幂等跳过，表内恒无重复。
    public func add(_ rules: [Rule]) {
        precondition(!rules.isEmpty, "add requires at least one rule")
        for rule in rules where !self.rules.contains(rule) {
            self.rules.append(rule)
        }
        canonicalize()
        persist()
    }

    /// 以 new 替换 old（可跨 action/kind 迁移）；new 与既有条目重复时仅删 old，不产生第二条。
    public func replace(old: Rule, new: Rule) {
        precondition(rules.contains(old), "unknown rule: \(old)")
        rules.removeAll { $0 == old }
        if !rules.contains(new) { rules.append(new) }
        canonicalize()
        persist()
    }

    public func remove(_ rule: Rule) {
        precondition(rules.contains(rule), "unknown rule: \(rule)")
        rules.removeAll { $0 == rule }
        persist()
    }

    private func persist() {
        storage.save(Data(RuleCodec.encode(rules).utf8))
    }

    private func canonicalize() {
        rules.sort { canonicalCompare($0, $1) < 0 }
    }

    private func canonicalCompare(_ a: Rule, _ b: Rule) -> Int {
        if a.action != b.action { return a.action.rawValue - b.action.rawValue }
        if a.kind != b.kind { return a.kind.rawValue - b.kind.rawValue }
        return compareScalars(a.value, b.value)
    }

    // value 按 Unicode 标量字典序：显式逐标量比较，规避两端标准库串序语义差异（UTF-16 序 / 本地化序）。
    private func compareScalars(_ a: String, _ b: String) -> Int {
        var ai = a.unicodeScalars.makeIterator()
        var bi = b.unicodeScalars.makeIterator()
        while true {
            switch (ai.next(), bi.next()) {
            case (nil, nil): return 0
            case (nil, _): return -1
            case (_, nil): return 1
            case (let ca?, let cb?):
                if ca.value != cb.value { return ca.value < cb.value ? -1 : 1 }
            }
        }
    }
}

enum RuleCodec {
    private static let version = "v1"

    static func encode(_ rules: [Rule]) -> String {
        var out = version
        for r in rules {
            out += "\n"
            out += actionToken(r.action) + "\t" + kindToken(r.kind) + "\t" + esc(r.value)
        }
        return out
    }

    static func decode(_ text: String) -> [Rule] {
        if text.isEmpty { return [] }
        let lines = text.components(separatedBy: "\n")
        precondition(lines[0] == version, "unsupported rule store version: \(lines[0])")
        var rules: [Rule] = []
        for i in 1..<lines.count {
            let line = lines[i]
            if line.isEmpty { continue }
            let f = line.components(separatedBy: "\t")
            precondition(f.count == 3, "malformed rule record: expected 3 fields, got \(f.count)")
            rules.append(Rule(action: actionFrom(f[0]), kind: kindFrom(f[1]), value: unesc(f[2])))
        }
        return rules
    }

    private static func actionToken(_ action: RuleAction) -> String {
        switch action {
        case .reject: return "reject"
        case .direct: return "direct"
        case .proxy: return "proxy"
        }
    }

    // 未知 token 即枚举穷尽破坏：本仓是唯一写入者，坏数据必是本仓 bug。
    private static func actionFrom(_ token: String) -> RuleAction {
        switch token {
        case "reject": return .reject
        case "direct": return .direct
        case "proxy": return .proxy
        default: preconditionFailure("unknown rule action token: \(token)")
        }
    }

    private static func kindToken(_ kind: RuleKind) -> String {
        switch kind {
        case .domain: return "domain"
        case .domainSuffix: return "domain_suffix"
        case .ipCidr: return "ip_cidr"
        }
    }

    private static func kindFrom(_ token: String) -> RuleKind {
        switch token {
        case "domain": return .domain
        case "domain_suffix": return .domainSuffix
        case "ip_cidr": return .ipCidr
        default: preconditionFailure("unknown rule kind token: \(token)")
        }
    }

    /// 逐 **Unicode 标量**而非字素簇（同 `ProfileStore.escape` 的判据）：Swift 把 `"\r\n"`
    /// 视作单个 `Character`，逐 Character 时两个换行分支都不匹配，裸 CRLF 会被原样写进字段，
    /// 破坏行式记录且与 Kotlin（逐 UTF-16 Char）落盘字节不同。
    /// **本表无 golden 用例**：规则值经 `RuleToken.validate` 把关，带换行的值不可达，
    /// 不为不可达输入造夹具；此处与 `ProfileStore.escape`（有夹具锁定）保持同一实现。
    private static func esc(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.utf8.count)
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.unicodeScalars.append(scalar)
            }
        }
        return out
    }

    private static func unesc(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        let chars = Array(s)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\\", i + 1 < chars.count {
                switch chars[i + 1] {
                case "\\": out.append("\\")
                case "n": out.append("\n")
                case "r": out.append("\r")
                case "t": out.append("\t")
                default: out.append(chars[i + 1])
                }
                i += 2
            } else {
                out.append(c)
                i += 1
            }
        }
        return out
    }
}
