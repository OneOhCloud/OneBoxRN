package cloud.oneoh.oneboxn.core

// 下载内容准入：响应体存储前的三重判定——非空、可解析 JSON、顶层为对象。
// 与 iOS Core/ConfigCheck.swift 逐字对应，golden/config-check.json 是行为裁判。
// JsonError 是外部输入的解析失败，在此边界 catch 转类型化领域结果。

enum class ContentReject { EMPTY, NOT_JSON, NOT_OBJECT }

sealed interface ConfigVerdict {
    data object Valid : ConfigVerdict

    data class Invalid(val reason: ContentReject) : ConfigVerdict
}

object ConfigCheck {
    /** trim 仅用于空判定；解析用原文——BOM 前缀因此被 Json.parse 拒 → NOT_JSON（镜像 JS JSON.parse）。 */
    fun validate(content: String): ConfigVerdict {
        if (isBlank(content)) return ConfigVerdict.Invalid(ContentReject.EMPTY)
        val parsed = try {
            Json.parse(content)
        } catch (rejected: JsonError) {
            return ConfigVerdict.Invalid(ContentReject.NOT_JSON)
        }
        if (parsed !is JsonValue.JsonObject) return ConfigVerdict.Invalid(ContentReject.NOT_OBJECT)
        return ConfigVerdict.Valid
    }

    // 空判定只认 JSON 空白四字符：两端原生 trim 的 Unicode 空白集不一致（如 U+00A0），自实现保证对等。
    private fun isBlank(content: String): Boolean =
        content.all { it == ' ' || it == '\t' || it == '\n' || it == '\r' }
}
