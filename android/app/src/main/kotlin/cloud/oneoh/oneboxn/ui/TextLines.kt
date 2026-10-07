package cloud.oneoh.oneboxn.ui

/**
 * 文本的逐行只读视图，逐行等价于 `text.split("\n")`，但不复制文本：只常驻各行起点偏移，
 * 取行时才切出该行。配置正文按可见行虚拟化渲染，任一时刻只有
 * 数十行在场——把整份多 MB 文本再切成逐行字符串常驻，等于为看不见的行付一份全量副本。
 */
class TextLines(private val text: String) : AbstractList<String>() {
    private val lineStarts: IntArray = lineStartsOf(text)

    override val size: Int
        get() = lineStarts.size

    override fun get(index: Int): String {
        val start = lineStarts[index]
        val end = if (index + 1 < lineStarts.size) lineStarts[index + 1] - 1 else text.length
        return text.substring(start, end)
    }
}

// 行数 = 换行数 + 1（末尾换行后的空行也是一行，与 split 同）。
private fun lineStartsOf(text: String): IntArray {
    val starts = IntArray(text.count { it == '\n' } + 1)
    var slot = 1
    var newline = text.indexOf('\n')
    while (newline >= 0) {
        starts[slot++] = newline + 1
        newline = text.indexOf('\n', newline + 1)
    }
    return starts
}
