/**
 * 日志脱敏辅助函数 —— 纯函数、无依赖（node:test 覆盖）。
 *
 * 配置 URL 会在 path/query 里嵌入秘密 token，hostname 又是用户配置文件数据，
 * 因此两者都不得出现在环形缓冲区、TaskLog 或 Bugsnag 负载里
 * （docs/claude/config-fetch-policy.md § log redaction）。
 *
 * 这里的 djb2 输出是关联 ID，不是安全边界 —— 它按设计就短、可被暴力破解
 * （紧凑的 key / 日志 token）。白名单的信任判定仍用 SHA256（domain-suffix.ts）。
 * 绝不要拿这些哈希做验证。
 */

/** djb2，base36 编码。 */
export function djb2Hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}

/** `#<djb2>` —— 在不写出主机名的情况下关联关于同一主机的日志行。 */
export function redactHostname(host: string): string {
    return `#${djb2Hash(host)}`;
}

/**
 * `https://#ab3x9f/…#c9k2`（存在 query 时再加 `?…`）：scheme + host 哈希
 * + path 哈希 + query 存在标记。任何 path 或 query 文本都不会残留。
 * 无法解析的输入退化为完全哈希化的占位符。
 */
export function redactUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        const pathPart = url.pathname && url.pathname !== '/' ? `/…#${djb2Hash(url.pathname)}` : '/';
        const queryFlag = url.search ? '?…' : '';
        return `${url.protocol}//${redactHostname(url.hostname)}${pathPart}${queryFlag}`;
    } catch {
        return `unparseable#${djb2Hash(rawUrl)}`;
    }
}
