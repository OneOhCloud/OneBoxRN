import Foundation

// 严格 JSON（RFC 8259）的最小实现（零第三方依赖）：保对象键序、数字保原始字面（lexeme）、确定性紧凑编码。
// 这是配置合并两端逐字节对等的地基；与 Android core/Json.kt 逐字对应，golden/json.json 是行为裁判。
// JsonError 只用于外部输入的解析失败；内部不变量违背走 fail-fast 崩溃暴露。

public enum JsonValue {
    case jsonString(String)

    /// 数字保原始字面，序列化原样回写（不数值化，规避两端浮点差异）。
    case jsonNumber(String)

    case jsonBool(Bool)

    case jsonNull

    case jsonArray(JsonArray)

    case jsonObject(JsonObject)
}

public final class JsonArray {
    public var items: [JsonValue]

    public init(_ items: [JsonValue]) {
        self.items = items
    }
}

/// 保插入序的对象：键序即存储序，编码按此序输出。
public final class JsonObject {
    private var orderedKeys: [String] = []
    private var values: [String: JsonValue] = [:]

    public init() {}

    public var keys: [String] { orderedKeys }

    /// 键缺失是一等领域状态（本类型中唯一允许返回 nil 处）。
    public func get(_ key: String) -> JsonValue? { values[key] }

    /// 已存在键保位置覆盖值；新键追加尾部。
    public func set(_ key: String, _ value: JsonValue) {
        if values[key] == nil { orderedKeys.append(key) }
        values[key] = value
    }

    /// 不存在则空操作。
    public func remove(_ key: String) {
        if values.removeValue(forKey: key) != nil {
            orderedKeys.removeAll { $0 == key }
        }
    }
}

public struct JsonError: Error {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }
}

public enum Json {
    /// 严格解析（RFC 8259）：顶层值前后只允许空白；任何偏离抛 JsonError。
    public static func parse(_ text: String) throws -> JsonValue {
        var parser = Parser(text)
        parser.skipWhitespace()
        let value = try parser.parseValue()
        parser.skipWhitespace()
        if !parser.atEnd() { throw JsonError("unexpected trailing content at index \(parser.index)") }
        return value
    }

    /// 确定性紧凑编码：无空白、对象按存储键序、数字回写 lexeme 原文。
    public static func encode(_ value: JsonValue) -> String {
        var out = ""
        encodeValue(value, into: &out)
        return out
    }

    /// 确定性格式化投影：2 空格缩进、键后 ": "、逐项换行；空对象/数组保持 {} / []；其余规则与 encode 同源。
    public static func encodePretty(_ value: JsonValue) -> String {
        var out = ""
        encodePrettyValue(value, into: &out, depth: 0)
        return out
    }

    private static func encodePrettyValue(_ value: JsonValue, into out: inout String, depth: Int) {
        switch value {
        case .jsonArray(let array):
            if array.items.isEmpty {
                out += "[]"
                return
            }
            // 纯标量数组内联成一行：本仓最大的消费方是配置查看页，其排除网段/规则集是数千条
            // 标量，一行一条会把文档撑到近七千行——呈现端的内存与滚动代价直接与行数挂钩，
            // 而这些条目逐行阅读本就无意义。含对象/数组的项仍逐行展开，结构可读性不变。
            if array.items.allSatisfy({ if case .jsonArray = $0 { false } else if case .jsonObject = $0 { false } else { true } }) {
                out += "["
                for (i, item) in array.items.enumerated() {
                    if i > 0 { out += ", " }
                    encodeValue(item, into: &out)
                }
                out += "]"
                return
            }
            out += "[\n"
            for (i, item) in array.items.enumerated() {
                if i > 0 { out += ",\n" }
                appendIndent(&out, depth: depth + 1)
                encodePrettyValue(item, into: &out, depth: depth + 1)
            }
            out += "\n"
            appendIndent(&out, depth: depth)
            out += "]"
        case .jsonObject(let object):
            if object.keys.isEmpty {
                out += "{}"
                return
            }
            out += "{\n"
            for (i, key) in object.keys.enumerated() {
                if i > 0 { out += ",\n" }
                appendIndent(&out, depth: depth + 1)
                encodeString(key, into: &out)
                out += ": "
                encodePrettyValue(object.get(key)!, into: &out, depth: depth + 1)
            }
            out += "\n"
            appendIndent(&out, depth: depth)
            out += "}"
        // **列全而不写 `default:`**：`JsonValue` 是自有枚举 —— 加一种值类型时，
        // 编译器必须逼人回来判它要不要缩进呈现，而不是默默落进紧凑编码。
        case .jsonString, .jsonNumber, .jsonBool, .jsonNull:
            encodeValue(value, into: &out)
        }
    }

    private static func appendIndent(_ out: inout String, depth: Int) {
        out += String(repeating: "  ", count: depth)
    }

    private static func encodeValue(_ value: JsonValue, into out: inout String) {
        switch value {
        case .jsonString(let string): encodeString(string, into: &out)
        case .jsonNumber(let lexeme): out += lexeme
        case .jsonBool(let bool): out += bool ? "true" : "false"
        case .jsonNull: out += "null"
        case .jsonArray(let array):
            out += "["
            for (i, item) in array.items.enumerated() {
                if i > 0 { out += "," }
                encodeValue(item, into: &out)
            }
            out += "]"
        case .jsonObject(let object):
            out += "{"
            for (i, key) in object.keys.enumerated() {
                if i > 0 { out += "," }
                encodeString(key, into: &out)
                out += ":"
                encodeValue(object.get(key)!, into: &out)
            }
            out += "}"
        }
    }

    // 转义规则：双引号/反斜杠/五个短转义；其余 <0x20 用小写 \u00xx；'/' 不转义；非 ASCII 原样输出。
    private static func encodeString(_ s: String, into out: inout String) {
        out += "\""
        for c in s.unicodeScalars {
            switch c {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if c.value < 0x20 {
                    let hex = String(c.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(c)
                }
            }
        }
        out += "\""
    }
}

private struct Parser {
    let scalars: [Unicode.Scalar]
    var index = 0

    init(_ text: String) {
        scalars = Array(text.unicodeScalars)
    }

    func atEnd() -> Bool { index >= scalars.count }

    mutating func skipWhitespace() {
        while !atEnd() && (scalars[index] == " " || scalars[index] == "\t" || scalars[index] == "\n" || scalars[index] == "\r") {
            index += 1
        }
    }

    mutating func parseValue() throws -> JsonValue {
        if atEnd() { throw JsonError("unexpected end of input") }
        let c = scalars[index]
        switch c {
        case "{": return .jsonObject(try parseObject())
        case "[": return .jsonArray(try parseArray())
        case "\"": return .jsonString(try parseString())
        case "t": return try parseLiteral("true", .jsonBool(true))
        case "f": return try parseLiteral("false", .jsonBool(false))
        case "n": return try parseLiteral("null", .jsonNull)
        default:
            if c == "-" || isDigit(c) { return .jsonNumber(try parseNumber()) }
            throw JsonError("unexpected character '\(c)' at index \(index)")
        }
    }

    private mutating func parseObject() throws -> JsonObject {
        index += 1 // 消费 '{'
        let objectValue = JsonObject()
        skipWhitespace()
        if !atEnd() && scalars[index] == "}" {
            index += 1
            return objectValue
        }
        while true {
            skipWhitespace()
            if atEnd() || scalars[index] != "\"" { throw JsonError("expected string key at index \(index)") }
            let key = try parseString()
            skipWhitespace()
            try expect(":")
            skipWhitespace()
            objectValue.set(key, try parseValue()) // 重复键：后值胜、位置取首现（set 语义天然给出）
            skipWhitespace()
            if atEnd() { throw JsonError("unterminated object at index \(index)") }
            if scalars[index] == "," {
                index += 1
            } else if scalars[index] == "}" {
                index += 1
                return objectValue
            } else {
                throw JsonError("expected ',' or '}' at index \(index)")
            }
        }
    }

    private mutating func parseArray() throws -> JsonArray {
        index += 1 // 消费 '['
        var items: [JsonValue] = []
        skipWhitespace()
        if !atEnd() && scalars[index] == "]" {
            index += 1
            return JsonArray(items)
        }
        while true {
            skipWhitespace()
            items.append(try parseValue())
            skipWhitespace()
            if atEnd() { throw JsonError("unterminated array at index \(index)") }
            if scalars[index] == "," {
                index += 1
            } else if scalars[index] == "]" {
                index += 1
                return JsonArray(items)
            } else {
                throw JsonError("expected ',' or ']' at index \(index)")
            }
        }
    }

    private mutating func parseLiteral(_ literal: String, _ value: JsonValue) throws -> JsonValue {
        for expected in literal.unicodeScalars {
            if atEnd() || scalars[index] != expected { throw JsonError("invalid literal at index \(index)") }
            index += 1
        }
        return value
    }

    // 数字文法 -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?；通过即存 lexeme 原文。
    private mutating func parseNumber() throws -> String {
        let start = index
        if scalars[index] == "-" { index += 1 }
        if atEnd() { throw JsonError("truncated number at index \(index)") }
        if scalars[index] == "0" {
            index += 1
        } else if isDigit(scalars[index]) {
            while !atEnd() && isDigit(scalars[index]) { index += 1 }
        } else {
            throw JsonError("invalid number at index \(index)")
        }
        if !atEnd() && scalars[index] == "." {
            index += 1
            try consumeDigits("fraction")
        }
        if !atEnd() && (scalars[index] == "e" || scalars[index] == "E") {
            index += 1
            if !atEnd() && (scalars[index] == "+" || scalars[index] == "-") { index += 1 }
            try consumeDigits("exponent")
        }
        return String(String.UnicodeScalarView(scalars[start..<index]))
    }

    private mutating func consumeDigits(_ part: String) throws {
        if atEnd() || !isDigit(scalars[index]) { throw JsonError("digit expected in \(part) at index \(index)") }
        while !atEnd() && isDigit(scalars[index]) { index += 1 }
    }

    private mutating func parseString() throws -> String {
        index += 1 // 消费开引号
        var out = ""
        while true {
            if atEnd() { throw JsonError("unterminated string at index \(index)") }
            let c = scalars[index]
            if c == "\"" {
                index += 1
                return out
            }
            if c == "\\" {
                index += 1
                try parseEscape(into: &out)
                continue
            }
            if c.value < 0x20 { throw JsonError("raw control character in string at index \(index)") }
            out.unicodeScalars.append(c)
            index += 1
        }
    }

    private mutating func parseEscape(into out: inout String) throws {
        if atEnd() { throw JsonError("truncated escape at index \(index)") }
        let c = scalars[index]
        index += 1
        switch c {
        case "\"": out += "\""
        case "\\": out += "\\"
        case "/": out += "/"
        case "b": out += "\u{08}"
        case "f": out += "\u{0C}"
        case "n": out += "\n"
        case "r": out += "\r"
        case "t": out += "\t"
        case "u": try parseUnicodeEscape(into: &out)
        default: throw JsonError("unknown escape '\\\(c)' at index \(index - 1)")
        }
    }

    // \uXXXX：高代理项必须紧跟 \u 低代理项合成增补字符；孤立代理项两端无法一致编码为 UTF-8，拒绝。
    private mutating func parseUnicodeEscape(into out: inout String) throws {
        let code = try parseHex4()
        if (0xD800...0xDBFF).contains(code) {
            if index + 2 > scalars.count || scalars[index] != "\\" || scalars[index + 1] != "u" {
                throw JsonError("lone high surrogate at index \(index)")
            }
            index += 2
            let low = try parseHex4()
            if !(0xDC00...0xDFFF).contains(low) { throw JsonError("invalid low surrogate at index \(index)") }
            let combined = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
            out.unicodeScalars.append(Unicode.Scalar(combined)!)
        } else if (0xDC00...0xDFFF).contains(code) {
            throw JsonError("lone low surrogate at index \(index)")
        } else {
            out.unicodeScalars.append(Unicode.Scalar(code)!)
        }
    }

    private mutating func parseHex4() throws -> Int {
        if index + 4 > scalars.count { throw JsonError("truncated unicode escape at index \(index)") }
        var code = 0
        for _ in 0..<4 {
            guard let digit = hexDigit(scalars[index]) else { throw JsonError("invalid hex digit at index \(index)") }
            code = code * 16 + digit
            index += 1
        }
        return code
    }

    // 只认 ASCII 十六进制位，规避各平台「全角/其他数字」宽容差异。
    private func hexDigit(_ c: Unicode.Scalar) -> Int? {
        switch c.value {
        case 0x30...0x39: return Int(c.value - 0x30)
        case 0x61...0x66: return Int(c.value - 0x61 + 10)
        case 0x41...0x46: return Int(c.value - 0x41 + 10)
        default: return nil
        }
    }

    private func isDigit(_ c: Unicode.Scalar) -> Bool {
        c.value >= 0x30 && c.value <= 0x39
    }

    private mutating func expect(_ c: Unicode.Scalar) throws {
        if atEnd() || scalars[index] != c { throw JsonError("expected '\(c)' at index \(index)") }
        index += 1
    }
}
