import Foundation

// 引擎自陈：引擎特定的附加诊断结构，
// 只被开发者页消费，字段集随内核而变，故除引擎名与版本外一律进无结构的有序键值对——
// 换核或引擎加字段都不改本类型，也不新增 i18n 键。
// 与 Android core/EngineInfo.kt 逐字对应。

/// 键是引擎自陈的英文 token，原样呈现不翻译（与日志行同类）。
public struct EngineInfoEntry: Equatable, Sendable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

public struct EngineInfo: Equatable, Sendable {
    public let name: String
    public let version: String
    public let entries: [EngineInfoEntry]

    public init(name: String, version: String, entries: [EngineInfoEntry]) {
        self.name = name
        self.version = version
        self.entries = entries
    }

    /// 空值条目整条省略：引擎答不出的字段不该占一行占位。
    public static func of(name: String, version: String, entries: [EngineInfoEntry]) -> EngineInfo {
        EngineInfo(name: name, version: version, entries: entries.filter { !$0.value.isEmpty })
    }
}
