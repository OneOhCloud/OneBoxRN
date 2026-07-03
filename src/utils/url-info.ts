/**
 * 配置文件导入用的 URL / header 名称派生辅助函数 —— 纯核心。
 *
 * 独立于 src/utils.ts（后者会引入原生模块），使 import-flow 状态机与 Node 的
 * 类型剥离测试运行器都能使用；src/utils.ts 再把它们 re-export，现有调用点不受影响。
 */

/** 从 URL 字符串中提取 hostname；解析失败时返回 fallback。 */
export function urlHostname(url: string, fallback = ''): string {
    try { return new URL(url).hostname; } catch { return fallback; }
}

/**
 * 从 URL 中提取最后一个路径段（文件名），并做 URL 解码。
 * 当服务器不返回 Content-Disposition 头时，用作展示名的回退 —— 例如原始 gist
 * URL `/raw/abc/appstoreconnect.json` → `appstoreconnect.json`。
 * 解析失败或路径没有文件名段时返回 null。
 */
export function urlFilename(url: string): string | null {
    try {
        const pathname = new URL(url).pathname;
        const segments = pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        if (!last) return null;
        try {
            return decodeURIComponent(last);
        } catch {
            return last;
        }
    } catch {
        return null;
    }
}

/**
 * 纯粹从配置 URL 派生的展示名回退：先取最后一个路径段，否则 hostname，
 * 再否则字面量 'Profile'。由导入流程（Content-Disposition / 存储名之后的
 * 最后 ?? 分支）与 v1 → 多配置文件迁移共用，让两者遵循同一套策略。
 */
export function deriveProfileNameFromUrl(url: string): string {
    return urlFilename(url) ?? urlHostname(url, 'Profile');
}

/** 从 Content-Disposition 头值里解析配置文件名。未找到时返回 null。 */
export function getRemoteNameByContentDisposition(contentDisposition: string): string | null {
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches != null && matches[1]) {
        return decodeURIComponent(matches[1].replace(/['"]/g, ''));
    }
    return null;
}
