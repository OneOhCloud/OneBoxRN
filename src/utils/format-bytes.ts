// 全应用统一的字节大小格式化器。三位有效数字，二进制单位（1 KB = 1024 B）。
// 速率（"… /s"）是另一回事，这里不处理。

function formatSignificant(n: number): string {
    if (n >= 100) return Math.round(n).toString();
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/\.?0+$/, '');
}

export function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${formatSignificant(bytes / KB)} KB`;
    if (bytes < GB) return `${formatSignificant(bytes / MB)} MB`;
    return `${formatSignificant(bytes / GB)} GB`;
}
