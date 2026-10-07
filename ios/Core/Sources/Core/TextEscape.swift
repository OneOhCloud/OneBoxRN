import Foundation

// 行式存储的字段转义：把 `\ \n \r \t` 挪出字段值，好让换行分记录、制表符分字段。
// ProfileStore 与 RefreshRecordStore 共用同一份（同一端第三处重复即提炼）。
// 与 Android core/TextEscape.kt 逐字对应；ProfileStore 的字节特征测试是它的行为裁判。
enum TextEscape {
    /// 逐 **Unicode 标量**而非字素簇：Swift 把 `"\r\n"` 视作单个 `Character`，逐 Character
    /// 时两个换行分支都不匹配，裸 CRLF 会被原样写进字段——行式记录里出现真换行字节即格式破损，
    /// 且与 Kotlin（逐 UTF-16 Char，分别转义）落盘字节不同。特征测试锁定该情形。
    static func escape(_ s: String) -> String {
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

    // 直接消费 Substring 视图：不先把字段物化成 String，也不建字符数组（一个 Character 十六字节，
    // 对 MB 级内容那是数十兆的瞬时开销）。
    static func unescape<S: StringProtocol>(_ s: S) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        var characters = s.makeIterator()
        while let c = characters.next() {
            guard c == "\\", let escaped = characters.next() else {
                out.append(c)
                continue
            }
            switch escaped {
            case "\\": out.append("\\")
            case "n": out.append("\n")
            case "r": out.append("\r")
            case "t": out.append("\t")
            default: out.append(escaped)
            }
        }
        return out
    }
}
