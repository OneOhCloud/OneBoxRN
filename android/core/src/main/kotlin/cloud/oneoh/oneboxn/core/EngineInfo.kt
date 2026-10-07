package cloud.oneoh.oneboxn.core

// 引擎自陈：引擎特定的 diagnostics 附加结构，
// 只被开发者页消费，字段集随内核而变，故除引擎名与版本外一律进无结构的有序键值对——
// 换核或引擎加字段都不改本类型，也不新增 i18n 键。
// 与 iOS Core/EngineInfo.swift 逐字对应。

/** 键是引擎自陈的英文 token，原样呈现不翻译（与日志行同类）。 */
data class EngineInfoEntry(val key: String, val value: String)

data class EngineInfo(
    val name: String,
    val version: String,
    val entries: List<EngineInfoEntry>,
) {
    companion object {
        /** 空值条目整条省略：引擎答不出的字段不该占一行占位。 */
        fun of(name: String, version: String, entries: List<EngineInfoEntry>): EngineInfo =
            EngineInfo(name, version, entries.filter { it.value.isNotEmpty() })
    }
}
