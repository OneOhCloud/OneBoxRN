import Foundation

/// 文本的逐行只读视图，逐行等价于按 `\n` 切分，但**不复制文本**：只常驻各行起点，
/// 取行时才切出该行（与 Android `TextLines` 同名同形）。
///
/// 配置正文按可见行虚拟化渲染，任一时刻只有数十行在场——
/// 把整份文本再切成逐行字符串常驻，等于为看不见的行付一份全量副本。代价不只是常驻内存：
/// **每次进入页面都要重新物化全部行**，六千余次分配的抖动正是「反复进出页面内存增长」
/// 的来源之一；改成偏移后，每次进入只剩一趟扫描。
struct TextLines: RandomAccessCollection, Sendable {
    private let text: String
    private let lineStarts: [String.Index]

    init(_ text: String) {
        self.text = text
        self.lineStarts = Self.lineStarts(of: text)
    }

    var startIndex: Int { 0 }
    var endIndex: Int { lineStarts.count }

    subscript(position: Int) -> String {
        precondition(lineStarts.indices.contains(position), "line index out of range")
        let scalars = text.unicodeScalars
        let start = lineStarts[position]
        let end = position + 1 < lineStarts.count
            ? scalars.index(before: lineStarts[position + 1])   // 去掉行尾换行
            : scalars.endIndex
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }

    // 行数 = 换行数 + 1（末尾换行之后仍算一空行）。
    //
    // 按 **Unicode 标量**而非字素簇扫描：Swift 把 `"\r\n"` 视作单个 `Character`，逐 Character
    // 找 `"\n"` 会**整份 CRLF 文本一行都切不开**（导入视图会把整份配置显示成一整行）；
    // Kotlin 逐 UTF-16 Char 则正常切分。标量与 UTF-16 对 ASCII 换行等价，两端由此同形。
    private static func lineStarts(of text: String) -> [String.Index] {
        let scalars = text.unicodeScalars
        var starts: [String.Index] = [scalars.startIndex]
        var cursor = scalars.startIndex
        while let newline = scalars[cursor...].firstIndex(of: "\n") {
            let next = scalars.index(after: newline)
            starts.append(next)
            cursor = next
        }
        return starts
    }
}

extension TextLines: Equatable {
    /// 起点由原文确定性推导，比原文即可——不必逐个比对数千个索引。
    static func == (lhs: TextLines, rhs: TextLines) -> Bool {
        lhs.text == rhs.text
    }
}
