// Single byte-size formatter for the whole app. Three significant figures,
// binary units (1 KB = 1024 B). Replaces the former `fmtBytes` and the ad-hoc
// per-screen copies (dev-utils, task-detail-modal). Rates ("… /s") are a
// separate concern and are not handled here.

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
